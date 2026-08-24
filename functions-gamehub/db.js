/**
 * Firestore paths, and the environment boundary.
 *
 * Staging and production are two Hosting sites on ONE Firebase project, which
 * means one Firestore database. Devnet play and mainnet play would land in the
 * same leaderboards if nothing separated them, so every document this codebase
 * touches lives under `gamehub/{cluster}/…`.
 *
 * The cluster is passed in from the function's export — it is baked into the
 * deployed instance, never read from the request — so a staging deployment is
 * structurally incapable of writing mainnet data.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

export { FieldValue, Timestamp };

export const CLUSTERS = { MAINNET: "mainnet-beta", DEVNET: "devnet" };

let firestore = null;
export function db() {
  if (!firestore) {
    firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export function assertCluster(cluster) {
  if (cluster !== CLUSTERS.MAINNET && cluster !== CLUSTERS.DEVNET) {
    throw new Error(`unknown cluster: ${cluster}`);
  }
  return cluster;
}

/** The per-cluster root document, which also holds public tunable config. */
export function root(cluster) {
  return db().collection("gamehub").doc(assertCluster(cluster));
}

export function col(cluster, name) {
  return root(cluster).collection(name);
}

export function doc(cluster, name, id) {
  return col(cluster, name).doc(id);
}

/* ------------------------------------------------------------------ *
 * Period identifiers. All boundaries are UTC so a player's "day" is the
 * same everywhere, and so a rollover job has one unambiguous moment.
 * ------------------------------------------------------------------ */

/** @param {Date} at @returns {string} e.g. "2026-08-23" */
export function dayId(at) {
  return at.toISOString().slice(0, 10);
}

/** ISO-8601 week, Monday-based. @returns {string} e.g. "2026-W35" */
export function weekId(at) {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // Shift to the Thursday of this week: the ISO year is whichever year that
  // Thursday falls in, which is the whole point of the convention.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Start of the UTC day after `at`: when daily throws and shovels come back. */
export function nextDayBoundary(at) {
  const next = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, 0, 0, 0, 0),
  );
  return next;
}

/** Start of the next ISO week (Monday 00:00 UTC). */
export function nextWeekBoundary(at) {
  const dayOfWeek = (at.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + (7 - dayOfWeek), 0, 0, 0, 0),
  );
}

/** Board ids are `{game}:{period}:{id}` — the id a client can construct too. */
export function boardId(game, period, id) {
  return `${game}:${period}:${id}`;
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

export const RANKS = [
  { key: "stray", name: "Stray", threshold: 0 },
  { key: "puppy", name: "Puppy", threshold: 100 },
  { key: "goodboy", name: "Good Boy", threshold: 1000 },
  { key: "bestbuddy", name: "Best Buddy", threshold: 10000 },
  { key: "legendary", name: "Legendary Dog", threshold: 50000 },
  { key: "immortal", name: "Immortal Dog", threshold: 250000 },
];

export function rankFor(gbp) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (gbp >= rank.threshold) current = rank;
    else break;
  }
  return current;
}

export const DEFAULT_CONFIG = {
  /** Global pet milestones, in order. */
  milestones: [10000, 100000, 500000, 1000000, 5000000],
  /** Daily allowances. */
  fetchThrowsPerDay: 3,
  huntShovelsPerDay: 3,
  huntShovelsStakedBonus: 2,
  petCooldownMs: 2500,
  superPetCooldownMs: 20000,
  superPetPoints: 15,
  /** Streak multipliers, applied to fetch points. Stored x100 to stay integral. */
  streakTiers: [
    { days: 100, multiplierX100: 300 },
    { days: 30, multiplierX100: 200 },
    { days: 7, multiplierX100: 150 },
    { days: 1, multiplierX100: 100 },
  ],
  /** Weekly prize table, per board, in whole $BUDDY. */
  prizeTable: {
    "fetch:weekly": [250000, 150000, 100000, 50000, 50000],
    "pet:weekly": [250000, 150000, 100000, 50000, 50000],
    "runner:weekly": [250000, 150000, 100000, 50000, 50000],
  },
  /** Staging can run a week in an hour; production never does. */
  cycleAcceleration: 1,
};

export async function readConfig(cluster) {
  const snapshot = await root(cluster).get();
  return { ...DEFAULT_CONFIG, ...(snapshot.exists ? snapshot.data() : {}) };
}

/** Streak multiplier as an integer percentage (100 = 1.0x). */
export function streakMultiplierX100(config, streakDays) {
  for (const tier of config.streakTiers) {
    if (streakDays >= tier.days) return tier.multiplierX100;
  }
  return 100;
}
