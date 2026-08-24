/**
 * Leaderboards: a podium for the top three, a ledger for the rest, and the
 * viewer's own row pinned at the bottom when it would otherwise be off-screen.
 *
 * The pinned row is the point. A board that only shows the top 25 tells most
 * players nothing about themselves, which is the one thing they came to see.
 */
import React from "react";

import type { BoardEntry, Leaderboard } from "../lib/api";
import { commas } from "../lib/format";
import { EmptyState, WalletChip } from "./ui";

export function Podium({ top, you }: { top: BoardEntry[]; you?: string | null }) {
  if (top.length < 3) return null;
  // Second, first, third — so the winner stands in the middle.
  const order = [top[1], top[0], top[2]];
  const places = [2, 1, 3];

  return (
    <div className="podium">
      {order.map((entry, index) => (
        <div key={entry.wallet} className={`podium-slot podium-${places[index]}`}>
          <span className="podium-place">{places[index]}</span>
          <WalletChip address={entry.wallet} you={entry.wallet === you} />
          <span className="mono" style={{ fontSize: 13 }}>
            {commas(entry.points)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LeaderboardTable({
  board,
  you,
  unit = "points",
  emptyMessage = "Nobody has played this one yet. Be first.",
}: {
  board: Leaderboard | null;
  you?: string | null;
  unit?: string;
  emptyMessage?: string;
}) {
  if (!board) return <EmptyState kind="loading" message="counting the scores" />;
  if (!board.top.length) return <EmptyState message={emptyMessage} />;

  const youAreListed = board.top.some((entry) => entry.wallet === you);

  return (
    <div>
      <Podium top={board.top} you={you} />
      <table className="ledger">
        <thead>
          <tr>
            <th style={{ width: 44 }}>#</th>
            <th>wallet</th>
            <th className="num">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {board.top.map((entry) => (
            <tr key={entry.wallet} className={entry.wallet === you ? "is-mine" : ""}>
              <td className="mono muted">{entry.position}</td>
              <td>
                <WalletChip address={entry.wallet} you={entry.wallet === you} />
              </td>
              <td className="num">{commas(entry.points)}</td>
            </tr>
          ))}

          {/* Your row, when the board's visible slice does not include it. */}
          {board.you && !youAreListed && (
            <tr className="is-mine">
              <td className="mono muted">{board.you.position}</td>
              <td>
                <WalletChip address={board.you.wallet} you link={false} />
              </td>
              <td className="num">{commas(board.you.points)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {board.status === "final" && (
        <p className="label" style={{ marginTop: 10 }}>
          this board is sealed — the standings above are what the cycle paid on
        </p>
      )}
    </div>
  );
}
