/**
 * pump.fun display names.
 *
 * Wallets are unreadable, and most of this community already has an identity on
 * pump.fun. `frontend-api-v3.pump.fun/users/{address}` returns it, so the hub
 * can show "slingoor" instead of "5YRg…Uzij".
 *
 * Four things shape how it is done:
 *
 * It is proxied, not called from the browser. That endpoint sends no
 * `Access-Control-Allow-Origin`, so a page cannot read it directly.
 *
 * It is cached hard, and negatively. There is no batch endpoint — one wallet is
 * one request — and pump.fun rate-limits. A leaderboard of twenty-five wallets
 * would otherwise be twenty-five calls per view, most of them for wallets that
 * will never have a profile.
 *
 * It is undocumented and not ours. It can change or vanish without notice, so
 * every failure is silent and the hub falls back to the address, which is the
 * thing that was actually true all along.
 *
 * And it is never the only identifier shown. A username is a self-chosen label
 * on a third-party service: it can be changed, and it can imitate someone. The
 * address stays visible next to it.
 */
import { col, FieldValue } from "./db.js";

const ENDPOINT = "https://frontend-api-v3.pump.fun/users";

/** A found profile is re-checked daily; a missing one weekly. */
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounds one request's fan-out to pump.fun. */
const MAX_LOOKUPS = 12;
const FETCH_TIMEOUT_MS = 4000;

/**
 * Names live outside the cluster namespace: a wallet's pump.fun identity is the
 * same fact whichever chain the hub is pointed at, and devnet lookups warm the
 * cache production would otherwise have to fill itself.
 */
function cache() {
  return col("mainnet-beta", "pumpNames");
}

async function fetchProfile(wallet) {
  // Under the emulator, do not reach out to a third party. Tests would depend
  // on pump.fun being up and would spend their timeout budget waiting for it;
  // set GAMEHUB_PUMP_LOOKUP=1 to exercise the real call deliberately.
  if (process.env.FUNCTIONS_EMULATOR === "true" && !process.env.GAMEHUB_PUMP_LOOKUP) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}/${wallet}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { username: null, image: null, found: false };
    if (!response.ok) return null; // Transient: do not cache a rate-limit as "no profile".
    const body = await response.json();
    return {
      username: typeof body.username === "string" && body.username ? body.username : null,
      image: typeof body.profile_image === "string" ? body.profile_image : null,
      found: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a batch of wallets to names.
 *
 * Returns only what it knows. A wallet with no profile, or one pump.fun could
 * not be asked about right now, is simply absent from the result and the client
 * shows the address.
 */
export async function resolveNames(wallets) {
  const unique = [...new Set(wallets.filter(Boolean))].slice(0, 50);
  if (!unique.length) return {};

  const snapshots = await cache().where("__name__", "in", unique.slice(0, 30)).get().catch(() => null);
  const cached = new Map();
  if (snapshots) {
    for (const snapshot of snapshots.docs) cached.set(snapshot.id, snapshot.data());
  }

  const now = Date.now();
  const names = {};
  const stale = [];

  for (const wallet of unique) {
    const entry = cached.get(wallet);
    const ttl = entry?.found ? HIT_TTL_MS : MISS_TTL_MS;
    if (entry && now - (entry.checkedAtMs || 0) < ttl) {
      if (entry.username) names[wallet] = { username: entry.username, image: entry.image || null };
      continue;
    }
    stale.push(wallet);
  }

  // Only ever a bounded number of outbound calls per request.
  for (const wallet of stale.slice(0, MAX_LOOKUPS)) {
    const profile = await fetchProfile(wallet);
    if (!profile) continue; // Leave the old entry alone and try again later.
    await cache()
      .doc(wallet)
      .set(
        {
          wallet,
          username: profile.username,
          image: profile.image,
          found: profile.found,
          checkedAtMs: now,
          checkedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    if (profile.username) names[wallet] = { username: profile.username, image: profile.image };
  }

  return names;
}

export function mountNameRoutes(app) {
  app.get("/names", async (req, res, next) => {
    try {
      const wallets = String(req.query.wallets || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry));
      // Names are decoration, so a browser may hold them for a while.
      res.set("Cache-Control", "public, max-age=300");
      res.json({ names: await resolveNames(wallets) });
    } catch (error) {
      next(error);
    }
  });
}
