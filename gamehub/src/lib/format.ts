/** Formatting helpers, in the claim site's house style. */

export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (!address) return "";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function commas(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** "2d 14h 03m" / "14:03:22" — coarse far out, precise when it matters. */
export function countdown(msRemaining: number): string {
  if (msRemaining <= 0) return "now";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function multiplierLabel(multiplierX100: number): string {
  const whole = multiplierX100 / 100;
  return `${Number.isInteger(whole) ? whole : whole.toFixed(1)}×`;
}

export function buddyAmount(baseUnits: string | number): string {
  const amount = Number(baseUnits) / 1e6;
  if (!Number.isFinite(amount)) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1000) return `${Math.round(amount).toLocaleString("en-US")}`;
  return amount.toFixed(2);
}
