/**
 * Prizes and receipts.
 *
 * This page inherits the main site's posture: a claim about money is worth
 * nothing without the transaction that settles it. So every prize row links to
 * its payout on chain, and the page is equally clear about what is still owed.
 *
 * Payouts are made by hand from the team's Squads multisig against a sealed
 * snapshot of the week's boards. There is no hot wallet paying automatically,
 * which is slower and is the point.
 */
import React from "react";

import { HiddenBone } from "../hunt/hiddenBones";
import { EmptyState, WalletChip } from "../../components/ui";
import { api } from "../../lib/api";
import { commas } from "../../lib/format";
import { usePoll } from "../../lib/poll";
import { explorerTx } from "../../config";

const BOARD_NAMES: Record<string, string> = {
  fetch: "Daily Fetch",
  pet: "Pet the Dog",
  runner: "Buddy vs. The Rugs",
};

export default function PrizesPage() {
  const prizes = usePoll(() => api.prizes(), 120000);

  return (
    <div className="stack">
      <section className="card">
        <span className="label">how prizes work</span>
        <h2 className="serif" style={{ margin: "6px 0 10px" }}>
          Weekly, by hand, with receipts
        </h2>
        <ol className="stack" style={{ paddingLeft: 20, gap: 8, fontSize: 14 }}>
          <li>
            Every Monday at 00:05 UTC the week's boards are <strong>sealed</strong>. Later scores
            cannot change what a sealed board says.
          </li>
          <li>
            The top finishers on each board form that cycle's payout list, which is published as a
            snapshot with a hash.
          </li>
          <li>
            The list is paid from the team's <strong>Squads multisig vault</strong> — a 2-of-3
            approval, made by people, not a key sitting on a server.
          </li>
          <li>
            The transactions are recorded here. Every row below links to the one that paid it.
          </li>
        </ol>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>
          Points are kept off chain. The distributor program is immutable and has no instruction that
          can pay an arbitrary wallet, so this is the honest way to run a prize pool on top of it —
          and the receipts are what make it checkable.
        </p>
      </section>

      {prizes.data?.prizeTable && (
        <section className="card">
          <span className="label">this cycle's table</span>
          <table className="ledger" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>board</th>
                <th className="num">1st</th>
                <th className="num">2nd</th>
                <th className="num">3rd</th>
                <th className="num">4th–5th</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(prizes.data.prizeTable).map(([board, amounts]) => (
                <tr key={board}>
                  <td>{BOARD_NAMES[board.split(":")[0]] || board}</td>
                  {[0, 1, 2, 3].map((index) => (
                    <td key={index} className="num">
                      {amounts[index] ? commas(amounts[index]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <span className="label">amounts in $BUDDY</span>
        </section>
      )}

      {(prizes.data?.awaitingPayment.length ?? 0) > 0 && (
        <section className="card">
          <span className="label">sealed, not yet paid</span>
          <table className="ledger" style={{ marginTop: 10 }}>
            <tbody>
              {prizes.data!.awaitingPayment.map((cycle) => (
                <tr key={cycle.cycle}>
                  <td className="mono">{cycle.cycle}</td>
                  <td className="muted">{cycle.winners} winners</td>
                  <td className="num">{commas(cycle.totalBuddy)} $BUDDY</td>
                  <td className="label tone-warn" style={{ textAlign: "right" }}>
                    awaiting multisig
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label" style={{ marginTop: 8 }}>
            a sealed cycle stays listed here until the transactions exist
          </p>
        </section>
      )}

      <section className="card">
        <div className="spread">
          <span className="label">paid</span>
          <HiddenBone id="prizes-footer" />
        </div>

        {!prizes.data ? (
          <EmptyState kind="loading" message="reading the receipts" />
        ) : !prizes.data.paid.length ? (
          <EmptyState message="No cycle has been paid yet. The first one will appear here with its transactions." />
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {prizes.data.paid.map((cycle) => (
              <div key={cycle.cycle} className="card card-tight" style={{ background: "var(--panel-2)" }}>
                <div className="spread">
                  <span className="serif" style={{ fontSize: 17 }}>
                    {cycle.cycle}
                  </span>
                  <span className="mono tone-warn">{commas(cycle.totalBuddy)} $BUDDY</span>
                </div>

                <table className="ledger" style={{ marginTop: 8 }}>
                  <tbody>
                    {cycle.winners.map((winner, index) => (
                      <tr key={`${winner.wallet}-${winner.game}-${index}`}>
                        <td className="mono muted">#{winner.position}</td>
                        <td>
                          <WalletChip address={winner.wallet} />
                        </td>
                        <td className="muted" style={{ fontSize: 13 }}>
                          {BOARD_NAMES[winner.game] || winner.game}
                        </td>
                        <td className="num">{commas(winner.prizeBuddy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="row" style={{ marginTop: 10 }}>
                  <span className="label">transactions</span>
                  {cycle.txSignatures.map((signature) => (
                    <a
                      key={signature}
                      className="mono"
                      style={{ fontSize: 12 }}
                      href={explorerTx(signature)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {signature.slice(0, 8)}…
                    </a>
                  ))}
                  {cycle.receiptUrl && (
                    <a className="label" href={cycle.receiptUrl} target="_blank" rel="noreferrer">
                      snapshot json →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
