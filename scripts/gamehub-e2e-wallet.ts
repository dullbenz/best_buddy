/**
 * Create (or top up) the devnet wallet the game hub's end-to-end suite uses to
 * test stake-gated perks.
 *
 * Golden Bone, Super Pet and the extra Bone Hunt shovels are unlocked by having
 * $BUDDY staked, and the server decides that by reading the chain. Two of the
 * staging scenarios therefore need a wallet that genuinely holds a stake — a
 * stub would test the stub, not the gate.
 *
 * This is devnet only, and it refuses to run anywhere else. It mints from the
 * devnet mock mint using its mint authority (the local Solana keypair), which is
 * exactly what that mint exists for. Nothing here touches mainnet, the real
 * $BUDDY mint, or any wallet holding value.
 *
 * Environment:
 *   RPC_URL     devnet endpoint            (default https://api.devnet.solana.com)
 *   PROGRAM_ID  devnet distributor program (default the deployment F program)
 *   AUTHORITY   mint authority keypair     (default ~/.config/solana/id.json)
 *   WALLET      where to write/read the e2e keypair
 *                                          (default ~/BUDDY-E2E-STAKED-WALLET.json)
 *   MINT_UI     tokens to mint             (default 2000000)
 *   STAKE_UI    tokens to stake            (default 1000000)
 *
 * Prints the wallet's base58 secret at the end, for
 * `gh secret set E2E_STAKED_WALLET_SECRET --env staging`. It is a throwaway
 * devnet key that holds nothing but mock tokens.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp",
);
const AUTHORITY_PATH = process.env.AUTHORITY || resolve(homedir(), ".config/solana/id.json");
const WALLET_PATH = process.env.WALLET || resolve(homedir(), "BUDDY-E2E-STAKED-WALLET.json");
const MINT_UI = BigInt(process.env.MINT_UI || "2000000");
const STAKE_UI = BigInt(process.env.STAKE_UI || "1000000");

/** Enough SOL for rent on a token account, a stake position and fees. */
const FUND_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main(): Promise<void> {
  // Devnet only. A mint authority signing on mainnet is not a mistake worth
  // leaving available.
  if (!/devnet|localhost|127\.0\.0\.1/.test(RPC_URL)) {
    throw new Error(`RPC_URL must be a devnet endpoint, got ${RPC_URL}`);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair(AUTHORITY_PATH);

  let wallet: Keypair;
  if (existsSync(WALLET_PATH)) {
    wallet = loadKeypair(WALLET_PATH);
    console.log(`wallet     ${wallet.publicKey.toBase58()} (existing)`);
  } else {
    wallet = Keypair.generate();
    writeFileSync(WALLET_PATH, JSON.stringify(Array.from(wallet.secretKey)));
    chmodSync(WALLET_PATH, 0o600);
    console.log(`wallet     ${wallet.publicKey.toBase58()} (new, written to ${WALLET_PATH})`);
  }

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) throw new Error(`no config at ${configPda.toBase58()} — wrong program?`);

  // Config layout: disc(8) authority(32) reward_mint(32) locked(1) …
  const rewardMint = new PublicKey(configInfo.data.subarray(40, 72));
  const locked = configInfo.data[72] === 1;
  console.log(`program    ${PROGRAM_ID.toBase58()}`);
  console.log(`config     ${configPda.toBase58()} (locked: ${locked})`);
  console.log(`mint       ${rewardMint.toBase58()}`);
  if (!locked) {
    // `stake` asserts the config is locked, so an unlocked config means the
    // deployment was never finished and staking would fail anyway.
    throw new Error("config is not locked; this deployment cannot accept stakes yet");
  }

  const mintInfo = await connection.getAccountInfo(rewardMint);
  const tokenProgram = mintInfo!.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const decimals = mintInfo!.data[44];
  const unit = 10n ** BigInt(decimals);

  const mintAuthority = new PublicKey(mintInfo!.data.subarray(4, 36));
  if (!mintAuthority.equals(authority.publicKey)) {
    throw new Error(
      `${AUTHORITY_PATH} is ${authority.publicKey.toBase58()}, but the mint authority is ` +
        `${mintAuthority.toBase58()}. Point AUTHORITY at the right keypair.`,
    );
  }

  /* ---------------------------- fund with SOL ---------------------------- */

  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < FUND_LAMPORTS / 2) {
    console.log(`funding    ${FUND_LAMPORTS / LAMPORTS_PER_SOL} SOL from the authority…`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: wallet.publicKey,
        lamports: FUND_LAMPORTS,
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  } else {
    console.log(`funding    already holds ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  }

  /* ------------------------------ mint tokens ---------------------------- */

  const ata = getAssociatedTokenAddressSync(rewardMint, wallet.publicKey, false, tokenProgram);
  const held = await connection
    .getTokenAccountBalance(ata)
    .then((r) => BigInt(r.value.amount))
    .catch(() => 0n);

  if (held < STAKE_UI * unit) {
    console.log(`minting    ${MINT_UI.toLocaleString("en-US")} tokens…`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        ata,
        wallet.publicKey,
        rewardMint,
        tokenProgram,
      ),
      createMintToInstruction(
        rewardMint,
        ata,
        authority.publicKey,
        MINT_UI * unit,
        [],
        tokenProgram,
      ),
    );
    await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  } else {
    console.log(`minting    already holds ${(held / unit).toLocaleString("en-US")} tokens`);
  }

  /* -------------------------------- stake -------------------------------- */

  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), wallet.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const existing = await connection.getAccountInfo(positionPda);
  if (existing) {
    const staked = existing.data.readBigUInt64LE(40);
    if (staked > 0n) {
      console.log(`stake      already staked ${(staked / unit).toLocaleString("en-US")} tokens`);
      report(wallet);
      return;
    }
  }

  const idl = JSON.parse(
    readFileSync(resolve(process.cwd(), "idl/buddy_distributor.json"), "utf8"),
  );
  // The committed IDL names the mainnet program; this deployment is the same
  // code at a different address.
  idl.address = PROGRAM_ID.toBase58();

  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);

  console.log(`staking    ${STAKE_UI.toLocaleString("en-US")} tokens…`);
  const signature = await program.methods
    .stake(new BN((STAKE_UI * unit).toString()))
    .accountsPartial({
      owner: wallet.publicKey,
      source: ata,
      rewardMint,
      tokenProgram,
    })
    .rpc();
  console.log(`           ${signature}`);

  const after = await connection.getAccountInfo(positionPda);
  console.log(
    `position   ${positionPda.toBase58()} holds ${(after!.data.readBigUInt64LE(40) / unit).toLocaleString("en-US")} tokens`,
  );

  report(wallet);
}

function report(wallet: Keypair): void {
  console.log("");
  console.log("Set the end-to-end secret with:");
  console.log(
    `  gh secret set E2E_STAKED_WALLET_SECRET --env staging --body "${bs58.encode(wallet.secretKey)}"`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
