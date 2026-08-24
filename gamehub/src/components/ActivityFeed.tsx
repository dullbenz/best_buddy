/**
 * The activity feed.
 *
 * Runs of the same wallet doing the same thing are collapsed into one row with
 * a count. Petting is meant to be repetitive, so without this the feed fills
 * with ten identical lines from whoever tapped last and stops being a picture
 * of what the pack is doing — which is the only thing it is for.
 *
 * Collapsing is by *consecutive* runs, not by totals: the feed is a timeline,
 * and reordering it to group a wallet's whole day would make it a leaderboard.
 * The daily board next to it already does that job properly.
 */
import React from "react";

import type { FeedEvent } from "../lib/api";
import { commas } from "../lib/format";
import { EmptyState, WalletChip } from "./ui";

type Grouped = {
  key: string;
  event: FeedEvent;
  count: number;
  points: number;
};

export function groupFeed(events: FeedEvent[]): Grouped[] {
  const grouped: Grouped[] = [];
  for (const event of events) {
    const previous = grouped[grouped.length - 1];
    if (previous && previous.event.wallet === event.wallet && previous.event.type === event.type) {
      previous.count += 1;
      previous.points += event.points || 0;
      continue;
    }
    grouped.push({ key: event.id, event, count: 1, points: event.points || 0 });
  }
  return grouped;
}

export function ActivityFeed({
  events,
  you,
  emptyMessage = "Nobody has played yet today. Somebody has to be first.",
}: {
  events: FeedEvent[];
  you?: string | null;
  emptyMessage?: string;
}) {
  if (!events.length) return <EmptyState message={emptyMessage} />;

  const rows = groupFeed(events);

  return (
    <ul className="feed" style={{ marginTop: 10 }}>
      {rows.map((row) => (
        <li key={row.key}>
          {row.event.wallet ? (
            <WalletChip address={row.event.wallet} you={row.event.wallet === you} />
          ) : (
            <span className="chip">pack</span>
          )}
          <span className="feed-text">
            {row.event.text}
            {row.count > 1 && <span className="feed-run"> ×{row.count}</span>}
          </span>
          {row.points ? <span className="feed-points">+{commas(row.points)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
