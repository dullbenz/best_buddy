/**
 * Pay a game hub prize cycle from the team Squads vault.
 *
 * The hub's points are off chain. Prizes are not: at the end of a cycle the
 * weekly job seals the boards and writes a snapshot of who won what, and this
 * script turns that snapshot into Squads proposals that people approve.
 *
 * The deliberate shape of it:
 *
 *   - Nothing is automatic. No hot wallet holds the prize pool, and no server
 *     can move a token. A human runs this, and 2-of-3 members approve it.
 *   - The snapshot is the input, and its hash is checked. If the file has been
 *     edited since the server produced it, this refuses to build anything.
 *   - Transfers are chunked into proposals small enough to fit a transaction,
 *     and each chunk is idempotent about creating a winner's token account.
 *
 * Modes (ACTION, default "status"):
 *
 *   status   Read the snapshot, verify its hash, resolve every winner's token
 *            account, and print exactly what would be sent. Sends nothing.
 *
 *   propose  Create one Squads vault transaction + proposal per chunk, and
 *            approve each as this member. Remaining approvals and execution
 *            happen in the Squads app or via scripts/team-withdraw.ts's
 *            approve/execute modes, which drive the same proposals.
 *
 * Environment:
 *   RPC_URL      Solana RPC endpoint
 *   SNAPSHOT     path to the cycle JSON from GET /api/admin/prize-cycle/:id
 *   MINT         the $BUDDY mint
 *   ACTION       status | propose            (default status)
 *   MULTISIG     the Squads multisig account (propose)
 *   KEYPAIR      path to a member keypair    (propose)
 *   VAULT_INDEX  Squads vault index, default 0
 *   CHUNK        winners per proposal, default 8
 *
 * Example:
 *   RPC_URL=<rpc> SNAPSHOT=gamehub/public/receipts/2026-W35.json \
 *   MINT=G93spDaBFKHEjjURJ38uGoXwD7Wpfv5inihDLhybpump \
 *   npx ts-node scripts/gamehub-payout.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
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

type Winner = {
  wallet: string;
  board: string;
  game: string;
  position: number;
  points: number;
  prizeBuddy: number;
};

type Snapshot = {
  cluster: string;
  cycle: string;
  winners: Winner[];
  totalBuddy: number;
  artifactSha256: string;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/**
 * Re-derive the snapshot's hash the way the server did.
 *
 * The server hashes only the identity of the payout — cluster, cycle, winners —
 * so a regenerated file with a new timestamp still verifies, while an edited
 * winner or amount does not.
 */
function verifySnapshot(snapshot: Snapshot): void {
  const recomputed = createHash("sha256")
    .update(
      JSON.stringify({
        cluster: snapshot.cluster,
        cycle: snapshot.cycle,
        winners: snapshot.winners,
      }),
    )
    .digest("hex");

  if (recomputed !== snapshot.artifactSha256) {
    throw new Error(
      `Snapshot hash mismatch.\n` +
        `  file says:  ${snapshot.artifactSha256}\n` +
        `  recomputed: ${recomputed}\n` +
        `The winners list has been modified since the server produced it. Refusing to pay.`,
    );
  }
}

async function main(): Promise<void> {
  const action = (process.env.ACTION || "status").toLowerCase();
  const connection = new Connection(env("RPC_URL"), "confirmed");
  const snapshot: Snapshot = JSON.parse(readFileSync(env("SNAPSHOT"), "utf8"));
  const mint = new PublicKey(env("MINT"));
  const chunkSize = Number(process.env.CHUNK || 8);

  verifySnapshot(snapshot);

  if (!snapshot.winners.length) {
    console.log(`Cycle ${snapshot.cycle} has no winners. Nothing to pay.`);
    return;
  }

  // $BUDDY is Token-2022; read the mint rather than assuming either program.
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error(`mint ${mint.toBase58()} not found`);
  const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const decimals = (await getMint(connection, mint, "confirmed", tokenProgram)).decimals;
  const unit = 10n ** BigInt(decimals);

  const multisigPda = new PublicKey(
    process.env.MULTISIG || "11111111111111111111111111111111",
  );
  const vaultIndex = Number(process.env.VAULT_INDEX || 0);
  const [vault] = multisig.getVaultPda({ multisigPda, index: vaultIndex });
  const vaultAta = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);

  // Aggregate: one wallet can win on more than one board, and paying it twice
  // in one cycle is two transfers where one will do.
  const totals = new Map<string, bigint>();
  for (const winner of snapshot.winners) {
    const amount = BigInt(Math.round(winner.prizeBuddy)) * unit;
    totals.set(winner.wallet, (totals.get(winner.wallet) || 0n) + amount);
  }

  console.log(`cycle       ${snapshot.cycle} (${snapshot.cluster})`);
  console.log(`hash        ${snapshot.artifactSha256} ✓`);
  console.log(`mint        ${mint.toBase58()} (${decimals} dp, ${tokenProgram.toBase58().slice(0, 8)}…)`);
  console.log(`vault       ${vault.toBase58()}`);
  console.log(`vault ata   ${vaultAta.toBase58()}`);
  console.log(`winners     ${totals.size} wallets, ${snapshot.winners.length} placements`);
  console.log(`total       ${snapshot.totalBuddy.toLocaleString("en-US")} $BUDDY`);
  console.log("");

  const balance = await connection
    .getTokenAccountBalance(vaultAta)
    .then((result) => BigInt(result.value.amount))
    .catch(() => 0n);
  const required = [...totals.values()].reduce((sum, amount) => sum + amount, 0n);

  console.log(`vault holds ${(balance / unit).toLocaleString("en-US")} $BUDDY`);
  if (balance < required) {
    console.log(
      `::warning:: the vault is short by ${((required - balance) / unit).toLocaleString("en-US")} $BUDDY. ` +
        `Top it up (scripts/team-withdraw.ts) before executing.`,
    );
  }
  console.log("");

  const entries = [...totals.entries()].sort((a, b) => Number(b[1] - a[1]));
  const chunks: (typeof entries)[] = [];
  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(entries.slice(index, index + chunkSize));
  }

  const buildChunk = (chunk: typeof entries): TransactionInstruction[] => {
    const instructions: TransactionInstruction[] = [];
    for (const [wallet, amount] of chunk) {
      const owner = new PublicKey(wallet);
      const destination = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
      // Idempotent: a winner who already holds $BUDDY needs no new account, and
      // a proposal that fails because one of eight accounts exists is a waste
      // of an approval round.
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          vault,
          destination,
          owner,
          mint,
          tokenProgram,
        ),
      );
      instructions.push(
        createTransferCheckedInstruction(
          vaultAta,
          mint,
          destination,
          vault,
          amount,
          decimals,
          [],
          tokenProgram,
        ),
      );
    }
    return instructions;
  };

  chunks.forEach((chunk, index) => {
    console.log(`chunk ${index + 1}/${chunks.length}`);
    for (const [wallet, amount] of chunk) {
      console.log(`  ${wallet}  ${(amount / unit).toLocaleString("en-US").padStart(12)} $BUDDY`);
    }
  });
  console.log("");

  if (action === "status") {
    console.log("Read-only. To create the proposals:");
    console.log("  ACTION=propose MULTISIG=<msig> KEYPAIR=<member.json> npm run gamehub:payout");
    console.log("");
    console.log("After execution, record the signatures:");
    console.log(`  POST /api/admin/prize-cycle/${snapshot.cycle}/mark-paid`);
    console.log(`       {"txSignatures": ["…"], "receiptUrl": "/receipts/${snapshot.cycle}.json"}`);
    return;
  }

  if (action !== "propose") throw new Error(`unknown ACTION "${action}"`);

  const member = loadKeypair(env("KEYPAIR"));
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );

  // The SDK's helpers return once a transaction is sent, and each step reads
  // what the previous one wrote. Same race as team-withdraw.ts.
  const confirmed = async (signature: string) => {
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    return signature;
  };

  let transactionIndex = BigInt(multisigAccount.transactionIndex.toString());
  const created: bigint[] = [];

  for (const [index, chunk] of chunks.entries()) {
    transactionIndex += 1n;
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: vault,
      recentBlockhash: blockhash,
      instructions: buildChunk(chunk),
    });

    console.log(`chunk ${index + 1}: creating vault transaction #${transactionIndex}…`);
    await confirmed(
      await multisig.rpc.vaultTransactionCreate({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        creator: member.publicKey,
        vaultIndex,
        ephemeralSigners: 0,
        transactionMessage: message,
        memo: `gamehub prizes ${snapshot.cycle} (${index + 1}/${chunks.length})`,
      }),
    );

    await confirmed(
      await multisig.rpc.proposalCreate({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        creator: member,
      }),
    );

    await confirmed(
      await multisig.rpc.proposalApprove({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        member,
      }),
    );

    created.push(transactionIndex);
    console.log(`  #${transactionIndex} live with 1 approval`);
  }

  console.log("");
  console.log(`Created ${created.length} proposal(s): ${created.join(", ")}`);
  console.log("Other members approve in the Squads app, or with:");
  for (const index of created) {
    console.log(
      `  ACTION=approve INDEX=${index} MULTISIG=${multisigPda.toBase58()} KEYPAIR=<their-key.json> npm run team-withdraw`,
    );
  }
  console.log("Then execute each with ACTION=execute, and record the signatures with mark-paid.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
