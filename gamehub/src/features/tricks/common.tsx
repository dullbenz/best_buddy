/**
 * Shared bits of the tricks feature: labels and the rating display.
 */
import React from "react";

import type { TrickSummary, TrickTemplate } from "../../lib/api";

export const TEMPLATE_LABELS: Record<TrickTemplate, string> = {
  quiz: "quiz",
  scramble: "word scramble",
  riddle: "emoji riddle",
};

/** Mean of both dimensions out of 5, one decimal — or null before any votes. */
export function ratingOutOfFive(summary: TrickSummary): string | null {
  if (!summary.ratingCount) return null;
  const avgX10 = Math.round(
    ((summary.originalitySum + summary.funSum) * 10) / (summary.ratingCount * 2),
  );
  return `${Math.floor(avgX10 / 10)}.${avgX10 % 10}`;
}

export function TrickStats({ summary }: { summary: TrickSummary }) {
  const rating = ratingOutOfFive(summary);
  return (
    <span className="label">
      {TEMPLATE_LABELS[summary.template]} · {summary.itemCount} items · {summary.playCount}{" "}
      {summary.playCount === 1 ? "play" : "plays"}
      {rating ? ` · ★ ${rating}` : ""}
    </span>
  );
}
