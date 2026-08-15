/**
 * Snapshot holders of the old Buddy token and turn them into bucket-2
 * allocations.
 *
 * A Solana program cannot enumerate token holders, so eligibility is decided
 * off-chain here and committed on-chain as a single Merkle root. That is only
 * trustworthy because the input is public: anyone can re-run this script
 * against the same slot and must land on the identical root. `verify-snapshot.ts`
 * does exactly that.
 *
 * IMPORTANT: historical slots need an archival RPC. The public
 * `api.mainnet-beta.solana.com` endpoint only serves current state, so running
 * this after the announced slot has passed will silently produce a *different*
 * holder set. Use Helius / Triton / QuickNode with archival access, or run this
 * live at the announced slot. The script records the slot it actually read so
 * the discrepancy can never be hidden.
 *
 * Usage:
 *   RPC_URL=https://... ts-node scripts/snapshot.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Allocation, buildTree } from "./merkle";

/** The abandoned token this relaunch is making good on. */
const OLD_TOKEN_MINT = "7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/**
 * Addresses excluded from restitution, with the reason recorded so the
 * community can audit every exclusion rather than take it on faith.
 *
 * Fill this in from the receipts dossier before running for real. Liquidity
 * pool vaults must be excluded or the pool itself would claim a large share of
 * the bucket; the old dev's wallets are excluded on the merits.
 */
interface Exclusion {
  address: string;
  reason: string;
}

const EXCLUSIONS: Exclusion[] = [
  // { address: "<old dev wallet>", reason: "creator wallet: dumped on holders, see receipts #1" },
  // { address: "<PumpSwap pool vault>", reason: "AMM pool vault, not a community holder" },
  // { address: "<Meteora pool vault>",  reason: "AMM pool vault, not a community holder" },
];

/** Balances below this are ignored: dust accounts inflate the tree for nothing. */
const MIN_BALANCE_BASE_UNITS = 1n;

/** Total tokens allocated to bucket 2, in base units of the NEW token. */
const BUCKET_TWO_ALLOCATION = BigInt(
  process.env.BUCKET_TWO_ALLOCATION ?? "0"
);

interface HolderRow {
  owner: string;
  balance: bigint;
  tokenAccount: string;
}

async function fetchHolders(connection: Connection): Promise<{
  holders: HolderRow[];
  slot: number;
}> {
  const slot = await connection.getSlot("finalized");
  console.log(`reading token accounts at finalized slot ${slot}`);

  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: "finalized",
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: OLD_TOKEN_MINT } },
    ],
  });

  console.log(`found ${accounts.length} token accounts for the mint`);

  // Several token accounts can share an owner; restitution is per wallet.
  const byOwner = new Map<string, HolderRow>();
  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const owner = new PublicKey(data.subarray(32, 64)).toBase58();
    const balance = data.readBigUInt64LE(64);
    if (balance < MIN_BALANCE_BASE_UNITS) continue;

    const existing = byOwner.get(owner);
    if (existing) {
      existing.balance += balance;
    } else {
      byOwner.set(owner, {
        owner,
        balance,
        tokenAccount: pubkey.toBase58(),
      });
    }
  }

  return { holders: [...byOwner.values()], slot };
}

function applyExclusions(holders: HolderRow[]): {
  eligible: HolderRow[];
  excluded: Array<HolderRow & { reason: string }>;
} {
  const index = new Map(EXCLUSIONS.map((e) => [e.address, e.reason]));
  const eligible: HolderRow[] = [];
  const excluded: Array<HolderRow & { reason: string }> = [];

  for (const h of holders) {
    const reason = index.get(h.owner) ?? index.get(h.tokenAccount);
    if (reason) {
      excluded.push({ ...h, reason });
    } else {
      eligible.push(h);
    }
  }
  return { eligible, excluded };
}

/**
 * Distribute the bucket pro-rata to old holdings. The largest holder absorbs
 * the rounding remainder so the allocations sum to exactly the bucket total.
 * Otherwise a few base units would be permanently unclaimable and the sweep
 * accounting would never balance.
 */
function allocate(
  eligible: HolderRow[],
  bucketTotal: bigint
): Allocation[] {
  const totalHeld = eligible.reduce((s, h) => s + h.balance, 0n);
  if (totalHeld === 0n) throw new Error("no eligible balance to allocate");

  const sorted = [...eligible].sort((a, b) =>
    a.balance === b.balance ? a.owner.localeCompare(b.owner) : a.balance > b.balance ? -1 : 1
  );

  const allocations: Allocation[] = [];
  let assigned = 0n;
  for (let i = 1; i < sorted.length; i++) {
    const amount = (bucketTotal * sorted[i].balance) / totalHeld;
    if (amount <= 0n) continue;
    allocations.push({ address: sorted[i].owner, amount: amount.toString() });
    assigned += amount;
  }
  const remainder = bucketTotal - assigned;
  if (remainder > 0n) {
    allocations.unshift({ address: sorted[0].owner, amount: remainder.toString() });
  }
  return allocations;
}

async function main() {
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error("set RPC_URL to an archival Solana RPC endpoint");
  if (BUCKET_TWO_ALLOCATION <= 0n) {
    throw new Error("set BUCKET_TWO_ALLOCATION to the bucket-2 size in base units");
  }

  const connection = new Connection(rpc, "finalized");
  const { holders, slot } = await fetchHolders(connection);
  const { eligible, excluded } = applyExclusions(holders);

  console.log(
    `eligible wallets: ${eligible.length}, excluded: ${excluded.length}`
  );

  const allocations = allocate(eligible, BUCKET_TWO_ALLOCATION);
  const { tree, proofs, total } = buildTree(allocations);

  if (total !== BUCKET_TWO_ALLOCATION) {
    throw new Error(
      `allocation total ${total} does not equal bucket size ${BUCKET_TWO_ALLOCATION}`
    );
  }

  const outDir = path.join(__dirname, "..", "snapshot");
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = {
    oldTokenMint: OLD_TOKEN_MINT,
    slot,
    takenAt: new Date().toISOString(),
    bucketTwoAllocation: BUCKET_TWO_ALLOCATION.toString(),
    eligibleWallets: allocations.length,
    merkleRoot: tree.rootHex,
    exclusions: EXCLUSIONS,
    minBalanceBaseUnits: MIN_BALANCE_BASE_UNITS.toString(),
  };

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "allocations.json"),
    JSON.stringify(allocations, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "proofs.json"),
    JSON.stringify(proofs, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "holders.csv"),
    ["owner,old_balance,new_allocation"]
      .concat(
        allocations.map((a) => {
          const h = eligible.find((e) => e.owner === a.address);
          return `${a.address},${h ? h.balance.toString() : "0"},${a.amount}`;
        })
      )
      .join("\n")
  );
  fs.writeFileSync(
    path.join(outDir, "excluded.csv"),
    ["owner,balance,reason"]
      .concat(excluded.map((e) => `${e.owner},${e.balance},"${e.reason}"`))
      .join("\n")
  );

  console.log(`\nmerkle root: ${tree.rootHex}`);
  console.log(`wallets:     ${allocations.length}`);
  console.log(`total:       ${total}`);
  console.log(`written to:  ${outDir}`);
  console.log(
    "\nPublish every file in that directory. The root above is what goes on chain."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
