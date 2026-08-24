/**
 * Namespaced, versioned localStorage.
 *
 * Everything here is a convenience — a guest's best score, whether the sound is
 * muted, whether they have seen a game's rules. Nothing that matters lives
 * here, and every read is defensive: private browsing, cleared site data and
 * storage-blocking settings all make these calls throw.
 */
const PREFIX = "gh.";

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A viewer with storage disabled still gets a working hub.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export const KEYS = {
  session: "session.v1",
  guestFetch: "guest.fetch.v1",
  guestRunner: "guest.runner.v1",
  streak: "streak.v1",
  muted: "muted.v1",
  helpSeen: (game: string) => `help.${game}.v1`,
};
