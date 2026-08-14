/**
 * Generate a fabricated claim set for testing the Claims tab end to end.
 *
 * The claim UI cannot be exercised against an empty tree: with nobody in the
 * snapshot every wallet gets the same "not in the snapshot" answer, so the half
 * of the page that actually matters — the amount, the terms, the stream, the
 * claim button — is unreachable. This writes a small, deliberately fake
 * allocation set so those paths can be walked.
 *
 * Everything it writes lands under a cluster-scoped directory
 * (`public/proofs/devnet/`, `public/snapshot/devnet/`), never the bare paths a
 * mainnet build reads. A fabricated list served as the published snapshot would
 * be indistinguishable from quietly rewriting who is owed what, so the two can
 * never share a URL.
 *
 * Deterministic: the filler wallets are derived from fixed seeds, so re-running
 * reproduces byte-identical files and the same Merkle roots. Only TEST_WALLET
 * changes anything.
 *
 * Usage:
 *   TEST_WALLET=<base58> npx ts-node scripts/devnet-fixture.ts
 *
 * It prints the roots and the exact env for scripts/deploy-init.ts.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Allocation, buildTree } from "./merkle";

const CLUSTER = process.env.CLUSTER ?? "devnet";
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

/** The same 55/15/20/10 split the pre-commitment doc publishes. */
const DISTRIBUTOR_TOTAL = 200_000_000n * UNIT;
const BUCKET_TWO = (DISTRIBUTOR_TOTAL * 55n) / 100n;
const BUCKET_THREE = (DISTRIBUTOR_TOTAL * 15n) / 100n;
const SIGNER_ALLOC = (DISTRIBUTOR_TOTAL * 20n) / 100n;
const DEV_ALLOC = (DISTRIBUTOR_TOTAL * 10n) / 100n;

/**
 * Filler wallets, derived rather than generated.
 *
 * A tree with one leaf is its own root and every proof is empty, which would
 * pass on chain while testing none of the proof verification. These give the
 * tree real depth, and deriving them from fixed seeds keeps the roots stable
 * across runs so a re-run does not silently invalidate a deployed config.
 */
function filler(label: string): string {
  const seed = createHash("sha256").update(`buddy-devnet-${label}`).digest();
  return Keypair.fromSeed(seed).publicKey.toBase58();
}

function main() {
  const testWallet = process.env.TEST_WALLET;
  if (!testWallet) throw new Error("set TEST_WALLET to the address to test with");
  const target = new PublicKey(testWallet).toBase58();

  // Fabricated legacy balances, in whole tokens of the old mint. The test
  // wallet is given a middling holding rather than the largest — the biggest
  // holder absorbs the rounding remainder, and testing that path by accident
  // would hide an off-by-one in the ordinary case.
  const legacyHoldings: Array<[string, bigint]> = [
    [filler("holder-whale"), 24_000_000n],
    [target, 8_400_000n],
    [filler("holder-2"), 6_100_000n],
    [filler("holder-3"), 4_750_000n],
    [filler("holder-4"), 3_200_000n],
    [filler("holder-5"), 2_050_000n],
    [filler("holder-6"), 1_400_000n],
    [filler("holder-7"), 900_000n],
    [filler("holder-8"), 350_000n],
    [filler("holder-9"), 120_000n],
  ];

  // Two addresses that would have been excluded for real reasons, so the
  // excluded.csv path renders with content rather than an empty table.
  const excluded: Array<[string, bigint, string]> = [
    [filler("pool-vault"), 31_000_000n, "AMM pool vault, not a community holder"],
    [filler("old-dev"), 12_500_000n, "creator wallet — dumped on holders, see receipts #1"],
  ];

  const totalHeld = legacyHoldings.reduce((s, [, b]) => s + b, 0n);
  const sorted = [...legacyHoldings].sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1,
  );

  // Same allocation rule as scripts/snapshot.ts: pro-rata, largest holder
  // absorbs the remainder so the parts sum to exactly the bucket.
  const legacyAllocs: Allocation[] = [];
  let assigned = 0n;
  for (let i = 1; i < sorted.length; i++) {
    const amount = (BUCKET_TWO * sorted[i][1]) / totalHeld;
    legacyAllocs.push({ address: sorted[i][0], amount: amount.toString() });
    assigned += amount;
  }
  legacyAllocs.unshift({
    address: sorted[0][0],
    amount: (BUCKET_TWO - assigned).toString(),
  });

  // Influencers are hand-authored amounts, not derived — same as the real list.
  const influencerAllocs: Allocation[] = [
    { address: target, amount: (9_000_000n * UNIT).toString() },
    { address: filler("influencer-1"), amount: (7_500_000n * UNIT).toString() },
    { address: filler("influencer-2"), amount: (5_500_000n * UNIT).toString() },
    { address: filler("influencer-3"), amount: (4_000_000n * UNIT).toString() },
    { address: filler("influencer-4"), amount: (2_500_000n * UNIT).toString() },
  ];
  const infAssigned = influencerAllocs.reduce((s, a) => s + BigInt(a.amount), 0n);
  influencerAllocs.push({
    address: filler("influencer-5"),
    amount: (BUCKET_THREE - infAssigned).toString(),
  });

  const legacy = buildTree(legacyAllocs);
  const influencers = buildTree(influencerAllocs);

  if (legacy.total !== BUCKET_TWO) {
    throw new Error(`legacy total ${legacy.total} != bucket ${BUCKET_TWO}`);
  }
  if (influencers.total !== BUCKET_THREE) {
    throw new Error(`influencer total ${influencers.total} != bucket ${BUCKET_THREE}`);
  }

  const app = path.join(__dirname, "..", "app", "public");
  const proofDir = path.join(app, "proofs", CLUSTER);
  const snapDir = path.join(app, "snapshot", CLUSTER);
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(snapDir, { recursive: true });

  const write = (file: string, body: string) => {
    fs.writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
    console.log(`  ${path.relative(process.cwd(), file)}`);
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  // The claim UI wants { address, amount, proof } keyed by address; the `leaf`
  // buildTree also returns is a debugging aid it has no use for.
  const forApp = (proofs: Record<string, { address: string; amount: string; proof: string[] }>) =>
    Object.fromEntries(
      Object.entries(proofs).map(([k, v]) => [
        k,
        { address: v.address, amount: v.amount, proof: v.proof },
      ]),
    );

  const takenAt = new Date().toISOString();
  console.log("\nwriting fixture files:");
  write(path.join(proofDir, "old-holders.json"), json(forApp(legacy.proofs)));
  write(path.join(proofDir, "influencers.json"), json(forApp(influencers.proofs)));

  write(
    path.join(snapDir, "holders.csv"),
    ["owner,old_balance,new_allocation"]
      .concat(
        legacyAllocs.map((a) => {
          const held = legacyHoldings.find(([addr]) => addr === a.address)![1];
          return `${a.address},${held * UNIT},${a.amount}`;
        }),
      )
      .join("\n"),
  );
  write(
    path.join(snapDir, "excluded.csv"),
    ["owner,balance,reason"]
      .concat(excluded.map(([addr, bal, why]) => `${addr},${bal * UNIT},"${why}"`))
      .join("\n"),
  );
  write(
    path.join(snapDir, "manifest.json"),
    json({
      FIXTURE: `fabricated ${CLUSTER} test data — not a real snapshot`,
      oldTokenMint: "7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump",
      slot: Number(process.env.SNAPSHOT_SLOT ?? 0),
      takenAt,
      bucketTwoAllocation: BUCKET_TWO.toString(),
      eligibleWallets: legacyAllocs.length,
      merkleRoot: legacy.tree.rootHex,
      exclusions: excluded.map(([address, , reason]) => ({ address, reason })),
      minBalanceBaseUnits: "1",
    }),
  );
  write(
    path.join(snapDir, "influencers.csv"),
    ["address,allocation"]
      .concat(influencerAllocs.map((a) => `${a.address},${a.amount}`))
      .join("\n"),
  );
  write(
    path.join(snapDir, "influencers-manifest.json"),
    json({
      FIXTURE: `fabricated ${CLUSTER} test data — not a real list`,
      merkleRoot: influencers.tree.rootHex,
      entries: influencerAllocs.length,
      total: influencers.total.toString(),
      builtAt: takenAt,
    }),
  );

  const owed = (list: Allocation[]) =>
    (Number(BigInt(list.find((a) => a.address === target)!.amount) / UNIT)).toLocaleString();

  console.log(`\ntest wallet ${target}`);
  console.log(`  legacy holder: ${owed(legacyAllocs)} tokens`);
  console.log(`  influencer:    ${owed(influencerAllocs)} tokens`);
  console.log(`\nOLD_ROOT=${legacy.tree.rootHex}`);
  console.log(`INF_ROOT=${influencers.tree.rootHex}`);
  console.log(`OLD_ALLOC=${BUCKET_TWO}`);
  console.log(`INF_ALLOC=${BUCKET_THREE}`);
  console.log(`SIGNER_ALLOC=${SIGNER_ALLOC}`);
  console.log(`DEV_ALLOC=${DEV_ALLOC}`);
  console.log(`TOTAL_TO_VAULT=${DISTRIBUTOR_TOTAL}`);
  console.log(`SNAPSHOT_TAKEN_AT=${takenAt}`);
}

main();
