/**
 * Withdraw vested tokens from the team stream, through the Squads multisig.
 *
 * The team stream's beneficiary is the Squads vault, and the program requires
 * the beneficiary to SIGN `stream_withdraw` (and requires the destination
 * token account to be OWNED by the beneficiary). A vault is a PDA, so it
 * cannot sign a transaction directly; it signs through Squads' own flow:
 * a member proposes the instruction, the threshold approves, and Squads
 * executes it with the vault as signer via CPI. This script does the fiddly
 * part — building the exact instructions — so no one ever hand-types account
 * lists into a transaction builder on launch week.
 *
 * Nothing here can redirect the tokens: `stream_withdraw` refuses any
 * destination the vault does not own, so the only place a withdrawal can land
 * is the vault's own token account. That is enforced by the program, not by
 * this script.
 *
 * Modes (ACTION, default "status"):
 *
 *   status   Read the stream and print totals, vested, withdrawable now, and
 *            the two instructions (create the vault's token account if
 *            missing, then stream_withdraw) in copy-paste form for the Squads
 *            app's transaction builder. Read-only; sends nothing.
 *
 *   propose  Create the Squads vault transaction + proposal on chain, and
 *            approve it as this member. Requires MULTISIG (the multisig
 *            account address, NOT the vault) and KEYPAIR (a member key).
 *            Remaining approvals and execution happen in the Squads app, or
 *            with the approve/execute modes below.
 *
 *   approve  Approve proposal INDEX as this member.
 *   execute  Execute proposal INDEX once the threshold is met.
 *
 * Environment:
 *   RPC_URL       Solana RPC endpoint
 *   ACTION        status | propose | approve | execute   (default status)
 *   MULTISIG      the Squads multisig account (propose/approve/execute)
 *   KEYPAIR       path to a member keypair    (propose/approve/execute)
 *   VAULT_INDEX   Squads vault index, default 0
 *   INDEX         proposal/transaction index  (approve/execute)
 *
 * Examples:
 *   RPC_URL=<rpc> npx ts-node scripts/team-withdraw.ts
 *   RPC_URL=<rpc> ACTION=propose MULTISIG=<msig> KEYPAIR=member.json npx ts-node scripts/team-withdraw.ts
 *   RPC_URL=<rpc> ACTION=approve INDEX=1 MULTISIG=<msig> KEYPAIR=member2.json npx ts-node scripts/team-withdraw.ts
 *   RPC_URL=<rpc> ACTION=execute INDEX=1 MULTISIG=<msig> KEYPAIR=member.json npx ts-node scripts/team-withdraw.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import * as fs from "fs";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`missing required env var ${name}`);
  return value;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

/** The committed IDL when the build directory is absent, so this runs anywhere. */
function loadIdl(): any {
  for (const p of ["../target/idl/buddy_distributor.json", "../idl/buddy_distributor.json"]) {
    try {
      return require(p);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("no IDL found; run anchor build or check idl/");
}

/** Mirror of Stream::withdrawable, so the report can say the number. */
function withdrawable(stream: any, now: number): bigint {
  const total = BigInt(stream.total.toString());
  const withdrawn = BigInt(stream.withdrawn.toString());
  const start = Number(stream.start);
  const end = Number(stream.end);
  const cliff = Number(stream.cliff);
  if (now < cliff) return 0n;
  const vested =
    now >= end
      ? total
      : (total * BigInt(now - start)) / BigInt(end - start);
  return vested > withdrawn ? vested - withdrawn : 0n;
}

function printInstruction(label: string, ix: TransactionInstruction) {
  console.log(`--- ${label} ---`);
  console.log(`program: ${ix.programId.toBase58()}`);
  console.log(`data (base58): ${bs58.encode(ix.data)}`);
  console.log(`data (hex):    ${Buffer.from(ix.data).toString("hex")}`);
  console.log("accounts, in order:");
  ix.keys.forEach((k, i) => {
    const flags = [k.isSigner ? "signer" : null, k.isWritable ? "writable" : null]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${String(i + 1).padStart(2)}. ${k.pubkey.toBase58()}${flags ? `  (${flags})` : ""}`);
  });
  console.log("");
}

async function main() {
  const action = env("ACTION", "status");
  const connection = new Connection(env("RPC_URL"), "confirmed");

  // A read-only provider is enough to build instructions; only the Squads
  // actions need a real signer, and they load it themselves below.
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program(loadIdl(), provider) as Program<any>;
  const programId = program.programId;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];
  const configPda = pda([Buffer.from("config")]);
  const state = await (program.account as any).config.fetch(configPda);
  const beneficiary = new PublicKey(state.devWallet);
  const rewardMint = new PublicKey(state.rewardMint);
  const streamPda = pda([Buffer.from("stream"), beneficiary.toBuffer()]);
  const vaultPda = pda([Buffer.from("vault")]);
  // allowOwnerOffCurve: the whole point is that the owner is a PDA.
  const destination = getAssociatedTokenAddressSync(rewardMint, beneficiary, true);

  console.log("=== team stream, via the Squads multisig ===");
  console.log(`program:                 ${programId.toBase58()}`);
  console.log(`beneficiary (vault):     ${beneficiary.toBase58()}`);
  console.log(
    PublicKey.isOnCurve(beneficiary.toBytes())
      ? "  ⚠ on-curve: an ordinary wallet, not a Squads vault. This script still"
        + "\n    works, but the whole point of the multisig is that this should not"
        + "\n    be a single key on mainnet."
      : "  off-curve, consistent with a Squads vault"
  );
  console.log(`stream PDA:              ${streamPda.toBase58()}`);
  console.log(`destination (vault ATA): ${destination.toBase58()}`);
  console.log("");

  if (!state.devStreamCreated) {
    console.log("The team stream has not been created yet. Anyone can create it:");
    console.log("  RPC_URL=<rpc> KEYPAIR=<any-funded-key.json> npx ts-node scripts/create-dev-stream.ts");
    return;
  }

  const stream = await (program.account as any).stream.fetch(streamPda);
  const now = Math.floor(Date.now() / 1000);
  const available = withdrawable(stream, now);
  const total = BigInt(stream.total.toString());
  const withdrawn = BigInt(stream.withdrawn.toString());

  console.log(`total:        ${total}`);
  console.log(`withdrawn:    ${withdrawn}`);
  console.log(`cliff:        ${new Date(Number(stream.cliff) * 1000).toISOString()}`);
  console.log(`end:          ${new Date(Number(stream.end) * 1000).toISOString()}`);
  console.log(`withdrawable: ${available} (right now)`);
  console.log("");

  if (available === 0n) {
    console.log(
      now < Number(stream.cliff)
        ? "Nothing is withdrawable before the cliff. Nothing to propose."
        : "Nothing withdrawable right now; it accrues every second, so try later."
    );
    if (action === "status") return;
  }

  // The two instructions. The token account is created idempotently and the
  // vault pays its own rent, so the proposal works whether or not the account
  // already exists — but say which, because a proposal that does less than it
  // shows breeds distrust of the tool.
  const destinationExists = !!(await connection.getAccountInfo(destination));
  const instructions: TransactionInstruction[] = [];
  if (!destinationExists) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        beneficiary, // payer: the vault pays its own rent (keep a little SOL in it)
        destination,
        beneficiary,
        rewardMint
      )
    );
  }
  instructions.push(
    await program.methods
      .streamWithdraw()
      .accountsPartial({
        beneficiary,
        config: configPda,
        stream: streamPda,
        pool: pda([Buffer.from("pool")]),
        vault: vaultPda,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );

  if (action === "status") {
    console.log(
      destinationExists
        ? "The vault's token account exists; one instruction to propose:"
        : "The vault's token account does not exist yet; propose both instructions together (the vault pays the ~0.002 SOL rent, so keep a little SOL in it):"
    );
    console.log("");
    if (!destinationExists) {
      printInstruction("1. create the vault's token account (idempotent)", instructions[0]);
    }
    printInstruction(
      `${instructions.length}. stream_withdraw`,
      instructions[instructions.length - 1]
    );
    console.log("Paste these into the Squads app's transaction builder, or run");
    console.log("ACTION=propose with MULTISIG and KEYPAIR to do it from here.");
    return;
  }

  // ---- Squads actions ----
  const multisigPda = new PublicKey(env("MULTISIG"));
  const member = loadKeypair(env("KEYPAIR"));
  const vaultIndex = Number(env("VAULT_INDEX", "0"));
  const [derivedVault] = multisig.getVaultPda({ multisigPda, index: vaultIndex });

  if (!derivedVault.equals(beneficiary)) {
    throw new Error(
      `vault ${vaultIndex} of multisig ${multisigPda.toBase58()} is ${derivedVault.toBase58()}, ` +
        `but the stream pays ${beneficiary.toBase58()}. Wrong multisig, wrong vault index, ` +
        `or the config's dev_wallet is not this Squads vault.`
    );
  }

  // The SDK's rpc helpers return as soon as the transaction is *sent*, and
  // each of these three steps reads state the previous one wrote. Without an
  // explicit confirmation in between, proposalCreate races vaultTransactionCreate
  // and dies with InvalidTransactionIndex — found the hard way on devnet.
  const confirmed = async (signature: string) => {
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    return signature;
  };

  if (action === "propose") {
    const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
    const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: derivedVault,
      recentBlockhash: blockhash,
      instructions,
    });

    console.log(`creating vault transaction #${transactionIndex}...`);
    const sig1 = await confirmed(
      await multisig.rpc.vaultTransactionCreate({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        creator: member.publicKey,
        vaultIndex,
        ephemeralSigners: 0,
        transactionMessage: message,
        memo: "team stream withdraw",
      })
    );
    console.log(`  ${sig1}`);

    console.log("creating proposal...");
    const sig2 = await confirmed(
      await multisig.rpc.proposalCreate({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        creator: member,
      })
    );
    console.log(`  ${sig2}`);

    console.log("approving as this member...");
    const sig3 = await confirmed(
      await multisig.rpc.proposalApprove({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        member,
      })
    );
    console.log(`  ${sig3}`);

    console.log("");
    console.log(`Proposal #${transactionIndex} is live with 1 approval.`);
    console.log("Other members approve in the Squads app, or with:");
    console.log(`  ACTION=approve INDEX=${transactionIndex} MULTISIG=${multisigPda.toBase58()} KEYPAIR=<their-key.json>`);
    console.log(`then anyone executes with ACTION=execute INDEX=${transactionIndex}.`);
    return;
  }

  const transactionIndex = BigInt(env("INDEX"));

  if (action === "approve") {
    const sig = await multisig.rpc.proposalApprove({
      connection,
      feePayer: member,
      multisigPda,
      transactionIndex,
      member,
    });
    console.log(`approved #${transactionIndex}: ${sig}`);
    return;
  }

  if (action === "execute") {
    const sig = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: member,
      multisigPda,
      transactionIndex,
      member: member.publicKey,
    });
    console.log(`executed #${transactionIndex}: ${sig}`);
    console.log("The withdrawn tokens are in the vault's token account:");
    console.log(`  ${destination.toBase58()}`);
    return;
  }

  throw new Error(`unknown ACTION "${action}" (status | propose | approve | execute)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
