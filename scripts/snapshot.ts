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

// The old Buddy mint is a Token-2022 mint, not classic SPL Token. Rather than
// hardcode either program, fetchHolders reads the mint's owning program at run
// time and queries that, so the snapshot is correct whichever token program the
// mint uses. See fetchHolders for why the dataSize: 165 filter is omitted.

/**
 * Addresses excluded from restitution, with the reason recorded so the
 * community can audit every exclusion rather than take it on faith.
 *
 * Seeded from the receipts dossier (docs/RECEIPTS.md §1 creator wallets, §5 pool
 * and infrastructure addresses). Liquidity pool vaults must be excluded or the
 * pool itself would claim a large share of the bucket and nothing could ever
 * claim it (a PDA has no key); the old dev's wallets are excluded on the merits.
 *
 * IMPORTANT — re-verify against the actual snapshot slot before publishing the
 * root. Holder balances move slot to slot: a trading bot can hold millions at one
 * slot and nothing at the next, and a new pool can appear. Re-run the top-20
 * sweep (RECEIPTS.md §5) at the chosen slot and extend this list with any
 * non-person holder it surfaces. Matching works on either the wallet (owner) or
 * the token-account address, so both forms are safe to list.
 */
interface Exclusion {
  address: string;
  reason: string;
}

const EXCLUSIONS: Exclusion[] = [
  // Creator wallets — RECEIPTS.md §1, excluded on the merits.
  { address: "D3us8ZjT9eAZDBYYsowmfcDE87VvPbHRN1YaQckQQwnJ", reason: "creator wallet: launched and dumped the old token, receipts §1" },
  { address: "H9XXSb8jwVsDWvj577KP3w9i9hRvhz78kSftQqQw3jwv", reason: "creator dump-proceeds pass-through, receipts §1" },
  { address: "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6", reason: "funded the creator's launch, holds 0 Buddy, receipts §1" },
  { address: "E6VD9jaLaSdQkXRc5Sv8ZwnYtNX2b6WyvrSejyKYCnuX", reason: "round-tripped SOL with the creator, holds 0 Buddy, receipts §1" },
  // Pool / infrastructure vaults — RECEIPTS.md §5, contracts not people.
  { address: "3MePuztv5iB56hyecEaBztjxQQSgAs7m4G7yq7gKLs38", reason: "PumpSwap pool vault, not a community holder, receipts §5" },
  { address: "3HmXpoWkYxUmGT1i66NAFtrxGGM4w7Z9TG8TdZ9YUDy4", reason: "PumpSwap pool authority, not a community holder, receipts §5" },
  { address: "9U329jLt17aUrYbb4xD2tdjCtA1yQwZjVDPrnoYagq4k", reason: "Meteora DAMM v2 pool vault, not a community holder, receipts §5" },
  { address: "htjkX4zqELWzeHHEjkwgZcUWBDNbS9LSNWpygTmnRPf", reason: "Meteora DAMM v2 pool vault (second pool), not a community holder, receipts §5" },
  { address: "5mbHmspj9ye4eZiBEpy1SoMcE3uPR3WEGFf9DjjmRh6T", reason: "pump.fun bonding-curve token account (migrated, balance 0), receipts §5" },
  // Program-controlled trading vault surfaced by the top-20 sweep — RECEIPTS.md §5.
  { address: "4kPFFQZJ51RZvpqFCtozBquDZqnRd1ehiT9MazewbaPR", reason: "program-controlled trading vault (va1t8sdG… PDA), not a community holder, receipts §5" },
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

/**
 * Re-read a previously frozen holder set instead of the chain.
 *
 * `getProgramAccounts` can only see present state — no archival RPC will replay
 * it at a past slot. So once a snapshot is taken, the holder set survives only
 * because it was written to disk. That matters because the per-wallet amounts
 * depend on the distributor total, which is not known until the launch buy: the
 * amounts have to be recomputed *after* the set was frozen. Re-querying the
 * chain then would silently snapshot a different, later set of holders.
 *
 * `FROZEN_SNAPSHOT=<dir>` reads that directory's `holders.csv` and `manifest.json`
 * and rescales the same owners and balances to a new bucket size, preserving the
 * original slot. This is the launch-day path.
 */
function readFrozenHolders(dir: string): {
  holders: HolderRow[];
  slot: number;
  takenAt: string;
} {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
  );
  if (manifest.oldTokenMint !== OLD_TOKEN_MINT) {
    throw new Error(
      `frozen snapshot is for mint ${manifest.oldTokenMint}, not ${OLD_TOKEN_MINT}`
    );
  }

  // holders.csv is owner,old_balance,new_allocation — the old balance is the
  // frozen input; the allocation is the output being recomputed, so it is
  // ignored here. Excluded owners were already removed when it was written.
  const lines = fs
    .readFileSync(path.join(dir, "holders.csv"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(1);

  const holders: HolderRow[] = lines.map((line) => {
    const [owner, balance] = line.split(",");
    if (!owner || !balance) throw new Error(`malformed holders.csv row: "${line}"`);
    return { owner, balance: BigInt(balance), tokenAccount: "" };
  });

  console.log(
    `reusing frozen holder set from ${dir}: ${holders.length} wallets at slot ${manifest.slot}`
  );
  return { holders, slot: manifest.slot, takenAt: manifest.takenAt };
}

async function fetchHolders(connection: Connection): Promise<{
  holders: HolderRow[];
  slot: number;
}> {
  const slot = await connection.getSlot("finalized");
  console.log(`reading token accounts at finalized slot ${slot}`);

  // The mint decides which token program owns its accounts. The old Buddy mint
  // is Token-2022, whose accounts are variable-length (the 165-byte base account
  // plus TLV extensions), so we must query that program and must NOT filter on
  // dataSize: 165 or every account carrying an extension is silently dropped —
  // which would zero out real holders. The base layout (mint@0, owner@32,
  // amount@64) is identical across both token programs and unaffected by any
  // extension, so those offsets are read the same way regardless.
  const mintInfo = await connection.getAccountInfo(
    new PublicKey(OLD_TOKEN_MINT),
    "finalized"
  );
  if (!mintInfo) throw new Error(`mint ${OLD_TOKEN_MINT} not found`);
  const tokenProgram = mintInfo.owner;
  console.log(`mint token program: ${tokenProgram.toBase58()}`);

  const accounts = await connection.getProgramAccounts(tokenProgram, {
    commitment: "finalized",
    filters: [{ memcmp: { offset: 0, bytes: OLD_TOKEN_MINT } }],
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
  if (BUCKET_TWO_ALLOCATION <= 0n) {
    throw new Error("set BUCKET_TWO_ALLOCATION to the bucket-2 size in base units");
  }

  // Two modes: freeze a new holder set from the chain, or rescale one already
  // frozen on disk. The second needs no RPC at all and is the launch-day path.
  const frozenDir = process.env.FROZEN_SNAPSHOT;
  let holders: HolderRow[];
  let slot: number;
  let frozenTakenAt: string | undefined;
  if (frozenDir) {
    ({ holders, slot, takenAt: frozenTakenAt } = readFrozenHolders(frozenDir));
  } else {
    const rpc = process.env.RPC_URL;
    if (!rpc) throw new Error("set RPC_URL to an archival Solana RPC endpoint");
    ({ holders, slot } = await fetchHolders(new Connection(rpc, "finalized")));
  }

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
    // When rescaling a frozen set, the honest date is when the holders were
    // frozen, not when the amounts were recomputed — the slot and the date have
    // to describe the same moment or neither is checkable.
    takenAt: frozenTakenAt ?? new Date().toISOString(),
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
