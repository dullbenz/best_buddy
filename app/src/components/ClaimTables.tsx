import { useEffect, useMemo, useState } from "react";
import { solscanAccount } from "../config";
import { fmtAmount, fmtDate, fmtTokens, shortAddress } from "../format";
import type { LedgerRow } from "../useClaimData";

/**
 * Who is on each list, and what they have done about it.
 *
 * The claim page could tell you about your own wallet and nothing else, which
 * meant the lists were "published" in the sense that a CSV existed, and not in
 * any sense a person would recognise. Reading a Merkle proof file is not the
 * same as being able to see the list.
 *
 * Both tables are the same shape deliberately, so the difference between the
 * two buckets is visible in the columns rather than having to be remembered:
 * a holder claim is a single payment, an influencer claim opens a stream and
 * has a percentage that moves.
 */

type Which = "influencers" | "legacy";

/** Debounced so typing an address does not re-filter on every keystroke. */
function useDebounced<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 10000n) / whole) / 100;
}

export function ClaimTables({
  legacy,
  influencers,
  loading,
  error,
  highlight,
}: {
  legacy: LedgerRow[];
  influencers: LedgerRow[];
  loading: boolean;
  error: string | null;
  /** The connected wallet, marked in the table so it can be found at a glance. */
  highlight: string | null;
}) {
  const [which, setWhich] = useState<Which>("influencers");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim().toLowerCase());

  const rows = which === "influencers" ? influencers : legacy;

  const filtered = useMemo(() => {
    if (!search) return rows;
    return rows.filter(
      (r) =>
        r.address.toLowerCase().includes(search) ||
        (r.handle ?? "").toLowerCase().includes(search)
    );
  }, [rows, search]);

  const claimed = rows.filter((r) => r.claimedAt !== null).length;

  return (
    <section className="card">
      <h2>The published lists</h2>
      <p className="muted">
        Everyone on each list, what they are owed, and whether they have taken
        it. Read straight from the chain — the claim status here is the receipt
        the contract wrote, not a record we keep.
      </p>

      <div className="table-controls">
        <div className="seg">
          <button
            type="button"
            className={which === "influencers" ? "seg-btn is-active" : "seg-btn"}
            onClick={() => setWhich("influencers")}
          >
            Influencers
          </button>
          <button
            type="button"
            className={which === "legacy" ? "seg-btn is-active" : "seg-btn"}
            onClick={() => setWhich("legacy")}
          >
            Legacy holders
          </button>
        </div>

        <input
          type="search"
          className="table-search"
          spellCheck={false}
          autoComplete="off"
          placeholder={
            which === "influencers"
              ? "Search by handle or wallet address"
              : "Search by wallet address"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error ? (
        <p className="muted small">
          Could not read claim status from the chain: {error}. The allocations
          below still come from the published files.
        </p>
      ) : (
        <p className="muted small">
          {rows.length} on this list · {claimed} claimed · {rows.length - claimed}{" "}
          outstanding
          {which === "influencers" && (
            <>
              {" "}
              · every stream runs 30 days from the moment it is opened, so the
              percentages below move on their own
            </>
          )}
        </p>
      )}

      <div className="table-wrap">
        <table className="ledger">
          <thead>
            <tr>
              {which === "influencers" ? <th>Handle</th> : null}
              <th>Wallet</th>
              {which === "legacy" ? <th className="num">Held then</th> : null}
              <th className="num">Allocation</th>
              <th>Status</th>
              {which === "influencers" ? <th className="num">Withdrawn</th> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const mine = highlight === r.address;
              return (
                <tr key={r.address} className={mine ? "is-mine" : undefined}>
                  {which === "influencers" ? (
                    <td>{r.handle ?? <span className="muted">—</span>}</td>
                  ) : null}
                  <td>
                    <a
                      className="mono"
                      href={solscanAccount(r.address)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={r.address}
                    >
                      {shortAddress(r.address)}
                    </a>
                    {mine && <span className="mine-tag">you</span>}
                  </td>
                  {which === "legacy" ? (
                    <td className="num">
                      {r.legacyBalance === null ? (
                        <span className="muted">—</span>
                      ) : (
                        fmtTokens(r.legacyBalance, true)
                      )}
                    </td>
                  ) : null}
                  <td className="num">{fmtAmount(r.allocation, true)}</td>
                  <td>
                    {r.claimedAt === null ? (
                      <span className="pill pill-open">unclaimed</span>
                    ) : (
                      <span className="pill pill-done" title={fmtDate(r.claimedAt)}>
                        {which === "influencers" ? "streaming" : "claimed"}
                      </span>
                    )}
                  </td>
                  {which === "influencers" ? (
                    <td className="num">
                      {r.streamTotal === null || r.withdrawn === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {fmtTokens(r.withdrawn, true)}
                          <span className="muted"> · {pct(r.withdrawn, r.streamTotal).toFixed(1)}%</span>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {loading && <p className="muted small">Reading claim status from the chain…</p>}
      {!loading && rows.length === 0 && (
        <p className="muted small">
          This list is empty until the snapshot is published, just before launch.
        </p>
      )}
      {!loading && rows.length > 0 && filtered.length === 0 && (
        <p className="muted small">
          Nothing on this list matches “{query.trim()}”. Not being here is a
          real answer — it means the contract has nothing recorded for it.
        </p>
      )}
    </section>
  );
}
