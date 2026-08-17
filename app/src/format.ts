import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function toTokens(baseUnits: bigint | string | number): number {
  const value = BigInt(baseUnits.toString());
  return Number(value) / 10 ** TOKEN_DECIMALS;
}

/**
 * Two significant digits for amounts the 2-decimal formatters would round to
 * a bare "0". A card reading "0 SOL" next to an armed action button reads as
 * a bug (or worse, a scam) even when the underlying lamports are real, so a
 * nonzero amount must never display as exactly zero.
 */
const small = new Intl.NumberFormat("en", { maximumSignificantDigits: 2 });

function fmtNonzero(n: number, format: Intl.NumberFormat): string {
  if (n > 0 && n < 0.01) return small.format(n);
  return format.format(n);
}

export function fmtTokens(baseUnits: bigint | string | number, short = false): string {
  const n = toTokens(baseUnits);
  return fmtNonzero(n, short ? compact : plain);
}

/**
 * A token amount with its ticker.
 *
 * Use this anywhere the number stands on its own. The page quotes both token
 * amounts and SOL, so a bare figure is ambiguous, and it is most ambiguous on
 * the line telling somebody what they are owed, which is the worst place for
 * it. `fmtTokens` stays for the cases where the surrounding sentence already
 * names the unit.
 */
export function fmtAmount(baseUnits: bigint | string | number, short = false): string {
  return `${fmtTokens(baseUnits, short)} ${TOKEN_SYMBOL}`;
}

export function fmtSol(lamports: bigint | string | number): string {
  return fmtNonzero(Number(BigInt(lamports.toString())) / 1e9, plain);
}

/**
 * Human countdown to a unix timestamp. Returns null once it has passed, which
 * callers use to switch between "time left" and "closed" states.
 */
export function countdown(deadline: number, now = Date.now() / 1000): string | null {
  const remaining = deadline - now;
  if (remaining <= 0) return null;

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 365) {
    const years = (days / 365).toFixed(1);
    return `${years} years`;
  }
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * A timestamp in the reader's own timezone.
 *
 * Previously UTC, which is unambiguous and also asks every reader to do
 * arithmetic to answer "was that before or after I did the thing". The times
 * on this site are all things the reader did or watched happen, so their own
 * clock is the useful frame. The chain is still the source; only the rendering
 * is local.
 */
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function fmtDate(unix: number): string {
  return dateTime.format(new Date(unix * 1000));
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * A transaction signature, shortened from the front.
 *
 * Not the middle-ellipsis used for wallet addresses. An address is something
 * you recognise, so showing both ends helps you match it against one you
 * already know. A signature is something you look up (nobody has one
 * memorised), so a readable prefix you can search for beats two fragments.
 */
export function shortSignature(signature: string): string {
  return signature.length > 12 ? `${signature.slice(0, 12)}…` : signature;
}
