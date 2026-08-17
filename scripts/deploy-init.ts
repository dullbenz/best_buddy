/**
 * Initialize, fund and lock the distributor.
 *
 * Run this once, immediately after the pump.fun launch and the dev-buy. It is
 * deliberately a single script with a dry-run default: the sequence
 * initialize → fund → lock is the moment the published tokenomics become
 * binding, and it should happen in one reviewable step rather than a handful of
 * ad-hoc commands.
 *
 * Required environment:
 *   RPC_URL                  Solana RPC endpoint
 *   KEYPAIR                  path to the authority keypair
 *   REWARD_MINT              the new token mint from pump.fun
 *   DEV_WALLET               the team stream's beneficiary. For launch this is
 *                            the team's Squads multisig VAULT address, not any
 *                            member's wallet: the vault signs withdrawals
 *                            through the Squads proposal flow, and the lock
 *                            freezes this choice permanently.
 *   OLD_ROOT / INF_ROOT      hex Merkle roots (no 0x)
 *   OLD_ALLOC / INF_ALLOC / SIGNER_ALLOC / DEV_ALLOC   base-unit amounts.
 *                            The published split is 15/50/10/25 of the
 *                            distributor total (legacy holders, influencers,
 *                            2014 signer, team) and they must sum to exactly
 *                            what fund_vault will move.
 *   SIGNER_PUBKEY            130-hex-char uncompressed key from the 2014 tx (with 04 prefix)
 *   SOURCE_TOKEN_ACCOUNT     token account holding the tokens to move into the vault
 *   DEV_CLIFF_DAYS           optional, defaults to 30
 *   EXECUTE=1                actually send; omit for a dry run
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as fs from "fs";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`missing required env var ${name}`);
  return value;
}

function hexToBytes(hex: string, expectedLength: number): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = Buffer.from(clean, "hex");
  if (bytes.length !== expectedLength) {
    throw new Error(
      `expected ${expectedLength} bytes but got ${bytes.length} from "${hex.slice(0, 16)}..."`
    );
  }
  return Array.from(bytes);
}

/**
 * The 2014 key is published as the 65-byte uncompressed form (0x04 || X || Y);
 * the program stores the 64-byte X||Y that `secp256k1_recover` returns.
 */
function signerKeyToXY(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 130) {
    if (!clean.startsWith("04")) {
      throw new Error("130-char key must start with 04 (uncompressed form)");
    }
    return hexToBytes(clean.slice(2), 64);
  }
  if (clean.length === 128) return hexToBytes(clean, 64);
  throw new Error(
    "SIGNER_PUBKEY must be the uncompressed key: 130 hex chars with the 04 prefix, or 128 without"
  );
}

async function main() {
  const execute = process.env.EXECUTE === "1";
  const connection = new Connection(env("RPC_URL"), "confirmed");
  const authority = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(env("KEYPAIR"), "utf8")))
  );
  const provider = new AnchorProvider(connection, new Wallet(authority), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = require("../target/idl/buddy_distributor.json");
  const program = new Program(idl, provider) as Program<any>;
  const programId = program.programId;

  const rewardMint = new PublicKey(env("REWARD_MINT"));
  const devWallet = new PublicKey(env("DEV_WALLET"));
  const source = new PublicKey(env("SOURCE_TOKEN_ACCOUNT"));

  const oldAlloc = new BN(env("OLD_ALLOC"));
  const infAlloc = new BN(env("INF_ALLOC"));
  const signerAlloc = new BN(env("SIGNER_ALLOC"));
  const devAlloc = new BN(env("DEV_ALLOC"));
  const total = oldAlloc.add(infAlloc).add(signerAlloc).add(devAlloc);
  const devCliffDays = Number(env("DEV_CLIFF_DAYS", "30"));

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool")], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
  const [solVault] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault")], programId);

  console.log("=== distributor initialization plan ===");
  console.log(`program:        ${programId.toBase58()}`);
  console.log(`authority:      ${authority.publicKey.toBase58()}`);
  console.log(`reward mint:    ${rewardMint.toBase58()}`);
  console.log(`config PDA:     ${config.toBase58()}`);
  console.log(`token vault:    ${vault.toBase58()}`);
  console.log(`SOL vault:      ${solVault.toBase58()}`);
  console.log("");
  console.log(`bucket 2 (old holders): ${oldAlloc.toString()}`);
  console.log(`bucket 3 (influencers): ${infAlloc.toString()}`);
  console.log(`bucket 4a (2014 signer): ${signerAlloc.toString()}`);
  console.log(`bucket 4b (team, ${devCliffDays}d cliff): ${devAlloc.toString()}`);
  console.log(`total to move into vault: ${total.toString()}`);
  console.log("");

  // A Squads vault is a PDA, and PDAs are off the ed25519 curve. This cannot
  // prove the address is the *right* vault, but it can catch the launch-night
  // mistake that matters: pasting a personal wallet where the team multisig
  // vault belongs. The lock freezes dev_wallet forever, so say it loudly now.
  console.log(`team wallet:    ${devWallet.toBase58()}`);
  if (PublicKey.isOnCurve(devWallet.toBytes())) {
    console.log(
      "    ⚠ ON-CURVE: this is an ordinary wallet keypair, NOT a Squads vault.\n" +
        "      Fine for a devnet rehearsal; on mainnet the team stream must pay\n" +
        "      the multisig vault, and this choice is frozen by lock_config."
    );
  } else {
    console.log(
      "    off-curve (program-derived), consistent with a Squads vault PDA"
    );
  }
  console.log("");

  const params = {
    oldHolderRoot: hexToBytes(env("OLD_ROOT"), 32),
    oldHolderAllocation: oldAlloc,
    influencerRoot: hexToBytes(env("INF_ROOT"), 32),
    influencerAllocation: infAlloc,
    originalSignerPubkey: signerKeyToXY(env("SIGNER_PUBKEY")),
    originalSignerAllocation: signerAlloc,
    devWallet,
    devAllocation: devAlloc,
    devCliffSeconds: new BN(devCliffDays * 86_400),
    claimsStart: new BN(0), // 0 = use the current block time
  };

  if (!execute) {
    console.log("DRY RUN. Set EXECUTE=1 to send these three transactions:");
    console.log("  1. initialize");
    console.log("  2. fund_vault");
    console.log("  3. lock_config   <-- irreversible; freezes every parameter above");
    return;
  }

  // Verify the source account actually holds what we are about to commit,
  // before touching anything on chain.
  const sourceInfo = await connection.getTokenAccountBalance(source);
  if (new BN(sourceInfo.value.amount).lt(total)) {
    throw new Error(
      `source holds ${sourceInfo.value.amount} but ${total.toString()} is required`
    );
  }

  // The mint decides its token program. pump.fun mints through `create_v2`
  // (Token-2022) while its create_v2_enabled flag is on and through `create`
  // (classic) when it is off, so read the answer from the mint account rather
  // than assume — the vault init and every transfer must name the same program.
  const mintInfo = await connection.getAccountInfo(rewardMint);
  if (!mintInfo) throw new Error(`reward mint ${rewardMint.toBase58()} not found`);
  const tokenProgram = mintInfo.owner;
  console.log(`reward mint token program: ${tokenProgram.toBase58()}`);

  console.log("1/3 initialize...");
  const sig1 = await program.methods
    .initialize(params)
    .accountsPartial({
      payer: authority.publicKey,
      authority: authority.publicKey,
      rewardMint,
      config,
      pool,
      vault,
      solVault,
      systemProgram: SystemProgram.programId,
      tokenProgram,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log(`    ${sig1}`);

  console.log("2/3 fund_vault...");
  const sig2 = await program.methods
    .fundVault(total)
    .accountsPartial({
      authority: authority.publicKey,
      config,
      vault,
      source,
      rewardMint,
      tokenProgram,
    })
    .rpc();
  console.log(`    ${sig2}`);

  console.log("3/3 lock_config...");
  const sig3 = await program.methods
    .lockConfig()
    .accountsPartial({ authority: authority.publicKey, config, pool, vault })
    .rpc();
  console.log(`    ${sig3}`);

  const state = await (program.account as any).config.fetch(config);
  console.log("\nlocked:", state.locked);
  console.log("old-holder deadline:", new Date(Number(state.oldHolderDeadline) * 1000).toISOString());
  console.log("influencer deadline:", new Date(Number(state.influencerDeadline) * 1000).toISOString());
  console.log("\nNext: run create_dev_stream, then publish the config address.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
