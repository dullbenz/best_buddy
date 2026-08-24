/**
 * Single source of truth for anything environment-shaped.
 *
 * Follows the claim site's conventions (app/src/config.ts): the cluster comes
 * from the build, the RPC endpoint is chosen at runtime by hostname, and a
 * mismatch throws at startup rather than quietly reading the wrong chain.
 */

export const CLUSTER = (import.meta.env.VITE_CLUSTER || "devnet") as "mainnet-beta" | "devnet";
export const IS_MAINNET = CLUSTER === "mainnet-beta";

if (CLUSTER !== "mainnet-beta" && CLUSTER !== "devnet") {
  throw new Error(`VITE_CLUSTER must be "mainnet-beta" or "devnet", got "${CLUSTER}"`);
}

function isLocalHost() {
  if (typeof location === "undefined") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

/**
 * The keyed RPC endpoint is locked to the site's origin at the provider, and
 * localhost cannot be added to that allowlist — hence a separate keyless
 * endpoint for local development. Same reasoning as the claim site.
 */
export const RPC_URL = isLocalHost()
  ? import.meta.env.VITE_LOCAL_RPC_URL || "https://api.devnet.solana.com"
  : import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com";

export const RPC_HOST = (() => {
  try {
    return new URL(RPC_URL).host;
  } catch {
    return "unknown";
  }
})();

/** Same origin in every environment: Hosting rewrites /api/** to the function. */
export const API_BASE = "/api";

export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID || "";

export const MAIN_SITE = IS_MAINNET ? "https://mybestbuddy.fun" : "https://staging.mybestbuddy.fun";
export const STAKING_URL = `${MAIN_SITE}/staking`;

export const EXPLORER_SUFFIX = IS_MAINNET ? "" : "?cluster=devnet";
export const explorerTx = (signature: string) =>
  `https://solscan.io/tx/${signature}${EXPLORER_SUFFIX}`;
export const explorerAddress = (address: string) =>
  `https://solscan.io/account/${address}${EXPLORER_SUFFIX}`;

/**
 * Firebase web configuration.
 *
 * These values are public by design — they identify the project, they do not
 * authorise anything. Access is decided by security rules and by the API's own
 * session checks. They come from build variables so this file carries no
 * project-specific literals.
 */
export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    `${import.meta.env.VITE_FIREBASE_PROJECT_ID || ""}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
};

export const USE_EMULATORS = isLocalHost() && import.meta.env.VITE_USE_EMULATORS !== "false";

/** Enabled only for builds that end-to-end tests drive. Never in production. */
export const TEST_WALLET_ENABLED = import.meta.env.VITE_ENABLE_TEST_WALLET === "true";

export const RANKS = [
  { key: "stray", name: "Stray", threshold: 0, blurb: "Just wandered in." },
  { key: "puppy", name: "Puppy", threshold: 100, blurb: "Learning where the treats are." },
  { key: "goodboy", name: "Good Boy", threshold: 1000, blurb: "Reliable. Sits when asked." },
  { key: "bestbuddy", name: "Best Buddy", threshold: 10000, blurb: "One of the pack now." },
  { key: "legendary", name: "Legendary Dog", threshold: 50000, blurb: "Spoken of at the park." },
  { key: "immortal", name: "Immortal Dog", threshold: 250000, blurb: "A very good boy, forever." },
] as const;

export type RankKey = (typeof RANKS)[number]["key"];

export type Rank = (typeof RANKS)[number];

export function rankFor(gbp: number): Rank {
  let current: Rank = RANKS[0];
  for (const rank of RANKS) {
    if (gbp >= rank.threshold) current = rank;
  }
  return current;
}

/** Input encoding for a fetch throw: both axes are 16-bit for the wire. */
export const THROW_Q_MAX = 65535;
