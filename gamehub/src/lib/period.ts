/**
 * Day and week identifiers, matching the server's board naming exactly.
 *
 * The client builds board ids locally so it can subscribe to today's board
 * without a round trip first. Both sides use UTC boundaries and ISO-8601 weeks;
 * a mismatch here would mean the hub quietly reading an empty board.
 *
 * Mirrors functions-gamehub/db.js — keep the two in step.
 */

/** "2026-08-24" */
export function dayId(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** ISO-8601 week, Monday-based: "2026-W35" */
export function weekId(at: Date = new Date()): string {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // Shift to this week's Thursday: the ISO year is whichever year it falls in.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export const boardId = (game: string, period: string, id: string) => `${game}:${period}:${id}`;
