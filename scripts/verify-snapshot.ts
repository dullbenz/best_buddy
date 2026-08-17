/**
 * Independent verification of a published snapshot.
 *
 * This is the script community members run to check the team's work. It takes
 * the published allocations, rebuilds the tree from scratch, and confirms the
 * root matches both the manifest and what is actually committed on chain. It
 * deliberately does not trust `proofs.json`; it regenerates every proof.
 *
 * Usage:
 *   ts-node scripts/verify-snapshot.ts [--onchain]
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Allocation, MerkleTree, buildTree, hashLeaf } from "./merkle";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "6gXQUJ8WQWZjhvNWPqDNMYk185hQyZyn3yTEAwkx6qHM"
);

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  const dir = process.env.SNAPSHOT_DIR ?? path.join(__dirname, "..", "snapshot");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
  );
  const allocations: Allocation[] = JSON.parse(
    fs.readFileSync(path.join(dir, "allocations.json"), "utf8")
  );

  console.log(`verifying snapshot from ${dir}`);
  console.log(`  mint:  ${manifest.oldTokenMint}`);
  console.log(`  slot:  ${manifest.slot}`);
  console.log(`  wallets: ${allocations.length}`);

  // 1. Rebuild the tree from the published allocations alone.
  const { tree, total } = buildTree(allocations);
  if (tree.rootHex !== manifest.merkleRoot) {
    fail(
      `rebuilt root ${tree.rootHex} does not match manifest ${manifest.merkleRoot}`
    );
  }
  console.log(`  root matches manifest: ${tree.rootHex}`);

  // 2. Totals must equal the declared bucket size exactly.
  if (total.toString() !== manifest.bucketTwoAllocation) {
    fail(
      `allocation total ${total} != declared bucket ${manifest.bucketTwoAllocation}`
    );
  }
  console.log(`  total matches declared bucket: ${total}`);

  // 3. Every single proof must verify against the rebuilt root.
  let checked = 0;
  for (const a of allocations) {
    const leaf = hashLeaf(a.address, BigInt(a.amount));
    const proof = tree.proofFor(leaf);
    if (!MerkleTree.verify(proof, tree.root, leaf)) {
      fail(`proof does not verify for ${a.address}`);
    }
    checked++;
  }
  console.log(`  all ${checked} proofs verify`);

  // 4. No duplicates, no non-positive amounts (buildTree already enforces both,
  //    but state it explicitly so the output is a readable audit log).
  const unique = new Set(allocations.map((a) => a.address));
  if (unique.size !== allocations.length) fail("duplicate addresses present");
  console.log(`  no duplicate addresses`);

  // 5. Optionally confirm the committed on-chain root is the same one.
  if (process.argv.includes("--onchain")) {
    const rpc = process.env.RPC_URL;
    if (!rpc) fail("set RPC_URL to check the on-chain root");
    const connection = new Connection(rpc, "confirmed");
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM_ID
    );
    const info = await connection.getAccountInfo(configPda);
    if (!info) fail(`config account ${configPda.toBase58()} not found`);

    // Layout: 8 discriminator + 32 authority + 32 mint + 1 locked + 8 claims_start
    const offset = 8 + 32 + 32 + 1 + 8;
    const onchainRoot = info.data.subarray(offset, offset + 32).toString("hex");
    if (onchainRoot !== tree.rootHex) {
      fail(`on-chain root ${onchainRoot} != rebuilt root ${tree.rootHex}`);
    }
    console.log(`  on-chain root matches: ${onchainRoot}`);
  }

  console.log("\nOK. This snapshot is internally consistent and reproducible.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
