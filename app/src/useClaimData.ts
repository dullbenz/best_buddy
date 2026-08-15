import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import { SEEDS, SNAPSHOT, pda } from "./config";
import { useProgram } from "./useProgram";

/**
 * The public claim ledger: who is on each list, and what they have done about it.
 *
 * Deliberately built from two `getProgramAccounts` calls rather than one lookup
 * per wallet. The holder list is thousands of rows in production, and asking
 * the chain about each one would be thousands of requests to render a table.
 * Fetching every receipt and every stream in two calls and joining locally
 * costs the same whether the list has ten rows or ten thousand.
 */

export interface LedgerRow {
  address: string;
  /** Influencer lists carry a handle; the holder list is addresses only. */
  handle: string | null;
  /** What the tree says this wallet is owed, in base units. */
  allocation: bigint;
  /** Balance of the legacy token at the snapshot, holder list only. */
  legacyBalance: bigint | null;
  claimedAt: number | null;
  /** Streams only: released so far, and the total being released. */
  withdrawn: bigint | null;
  streamTotal: bigint | null;
}

export interface Ledger {
  legacy: LedgerRow[];
  influencers: LedgerRow[];
  loading: boolean;
  error: string | null;
}

type ProofFile = Record<string, { address: string; amount: string }>;

/** `address,allocation,handle` and `owner,old_balance,new_allocation`. */
async function loadCsvColumn(
  url: string,
  keyColumn: number,
  valueColumn: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const res = await fetch(url);
  // A missing file is normal before the snapshot is published, and an SPA
  // rewrite answers 200 with HTML — so check the type, not just the status.
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) return out;
  const text = await res.text();
  for (const line of text.split("\n").slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length <= Math.max(keyColumn, valueColumn)) continue;
    if (!cells[keyColumn]) continue;
    out.set(cells[keyColumn], cells[valueColumn] ?? "");
  }
  return out;
}

export function useClaimLedger(
  oldProofs: ProofFile | null,
  infProofs: ProofFile | null
): Ledger {
  const program = useProgram();
  const { connection } = useConnection();
  const [receipts, setReceipts] = useState<Map<string, number> | null>(null);
  const [streams, setStreams] = useState<Map<string, { withdrawn: bigint; total: bigint }> | null>(null);
  const [handles, setHandles] = useState<Map<string, string>>(new Map());
  const [balances, setBalances] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const influencerCsv = SNAPSHOT.influencers.find((f) => f.name.endsWith(".csv"));
    const holderCsv = SNAPSHOT.legacy.find((f) => f.name === "holders.csv");
    if (influencerCsv) {
      loadCsvColumn(influencerCsv.url, 0, 2).then(setHandles).catch(() => {});
    }
    if (holderCsv) {
      loadCsvColumn(holderCsv.url, 0, 1).then(setBalances).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;

    (async () => {
      try {
        const [allReceipts, allStreams] = await Promise.all([
          (program.account as any).claimReceipt.all(),
          (program.account as any).stream.all(),
        ]);
        if (cancelled) return;

        // Receipts are keyed by their PDA, and the two buckets share one
        // account type — so the address alone cannot say which list a receipt
        // belongs to. The PDA can, since the seed differs.
        const byPda = new Map<string, number>();
        for (const r of allReceipts) {
          byPda.set(r.publicKey.toBase58(), Number(r.account.claimedAt));
        }
        setReceipts(byPda);

        const byBeneficiary = new Map<string, { withdrawn: bigint; total: bigint }>();
        for (const s of allStreams) {
          byBeneficiary.set(s.account.beneficiary.toBase58(), {
            withdrawn: BigInt(s.account.withdrawn.toString()),
            total: BigInt(s.account.total.toString()),
          });
        }
        setStreams(byBeneficiary);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, connection]);

  return useMemo(() => {
    const build = (
      proofs: ProofFile | null,
      seed: Buffer,
      withHandles: boolean
    ): LedgerRow[] => {
      if (!proofs) return [];
      return Object.values(proofs)
        .map((entry) => {
          const owner = new PublicKey(entry.address);
          const receiptPda = pda([seed, owner.toBuffer()]).toBase58();
          const stream = withHandles ? streams?.get(entry.address) : undefined;
          const legacy = balances.get(entry.address);
          return {
            address: entry.address,
            handle: withHandles ? handles.get(entry.address) ?? null : null,
            allocation: BigInt(entry.amount),
            legacyBalance: !withHandles && legacy ? BigInt(legacy) : null,
            claimedAt: receipts?.get(receiptPda) ?? null,
            withdrawn: stream ? stream.withdrawn : null,
            streamTotal: stream ? stream.total : null,
          };
        })
        .sort((a, b) => (a.allocation === b.allocation ? 0 : a.allocation > b.allocation ? -1 : 1));
    };

    return {
      legacy: build(oldProofs, SEEDS.oldClaim, false),
      influencers: build(infProofs, SEEDS.influencerClaim, true),
      loading: receipts === null && error === null,
      error,
    };
  }, [oldProofs, infProofs, receipts, streams, handles, balances, error]);
}

export interface WithdrawalEvent {
  signature: string;
  at: number | null;
  /** Base units released, parsed from the program log. */
  amount: bigint | null;
  kind: "opened" | "withdraw";
}

/**
 * Withdrawal history for one stream, reconstructed from chain.
 *
 * The stream account keeps a running total and no history at all, so the only
 * record of individual withdrawals is the transactions themselves. The program
 * logs the amount on every release, which makes them recoverable: list the
 * signatures that touched the stream account, fetch them in one batch, and
 * read the amounts back out of the logs.
 */
export function useStreamHistory(beneficiary: PublicKey | null) {
  const { connection } = useConnection();
  const [events, setEvents] = useState<WithdrawalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!beneficiary) {
      setEvents([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const streamPda = pda([SEEDS.stream, beneficiary.toBuffer()]);
        const sigs = await connection.getSignaturesForAddress(streamPda, { limit: 25 });
        if (cancelled || sigs.length === 0) {
          if (!cancelled) setEvents([]);
          return;
        }

        // One batched request rather than one per signature.
        const txs = await connection.getParsedTransactions(
          sigs.map((s) => s.signature),
          { maxSupportedTransactionVersion: 0 }
        );
        if (cancelled) return;

        const parsed: WithdrawalEvent[] = sigs.map((sig, i) => {
          const logs = txs[i]?.meta?.logMessages ?? [];
          const line = logs.find((l) => l.includes("stream_withdraw:"));
          const amount = line?.match(/released (\d+)/)?.[1];
          return {
            signature: sig.signature,
            at: sig.blockTime ?? null,
            amount: amount ? BigInt(amount) : null,
            kind: line ? "withdraw" : "opened",
          };
        });
        setEvents(parsed);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, beneficiary?.toBase58()]);

  return { events, loading };
}
