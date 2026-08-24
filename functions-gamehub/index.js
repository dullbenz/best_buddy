/**
 * Game hub function exports.
 *
 * Everything here exists twice: once bound to mainnet, once to devnet, under
 * different names. That is the whole environment-separation strategy, and it is
 * deliberate.
 *
 * Staging and production are two Hosting sites on a single Firebase project, so
 * a function named the same in both deploys is one function — a push to
 * `develop` would redeploy production's code. (The existing `terms` function has
 * exactly that problem today.) Separate names mean each workflow names what it
 * touches in `--only`, and neither can reach the other's instance.
 *
 * The cluster is a literal argument at export time, never read from config or a
 * request, so `gamehubApiStaging` is physically incapable of writing mainnet
 * collections.
 */
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";

import { makeApi } from "./api.js";
import { makeGate } from "./gate.js";
import {
  runDailyRollover,
  runWeeklyRollover,
  runPetAggregate,
  runStakeSnapshot,
  runHuntTick,
} from "./jobs.js";

if (getApps().length === 0) initializeApp();

const REGION = "us-central1";
const MAINNET = "mainnet-beta";
const DEVNET = "devnet";

const apiOptions = { region: REGION, memory: "512MiB", maxInstances: 10, cors: false };
const jobOptions = { region: REGION, memory: "512MiB", maxInstances: 1, timeoutSeconds: 540 };

/* --------------------------------- API --------------------------------- */

export const gamehubApi = onRequest(apiOptions, makeApi(MAINNET));
export const gamehubApiStaging = onRequest(apiOptions, makeApi(DEVNET));

/* ------------------------------ Staging gate ---------------------------- */

export const gamehubStagingGate = onRequest(
  { region: REGION, memory: "256MiB", maxInstances: 3 },
  makeGate(),
);

/* ----------------------------- Scheduled jobs --------------------------- */

/** Folds the sharded pet counter into one readable total and fires milestones. */
export const gamehubPetAggregate = onSchedule(
  { ...jobOptions, schedule: "* * * * *", timeZone: "UTC" },
  () => runPetAggregate(MAINNET),
);
export const gamehubPetAggregateStaging = onSchedule(
  { ...jobOptions, schedule: "* * * * *", timeZone: "UTC" },
  () => runPetAggregate(DEVNET),
);

/** Seals yesterday's boards, opens today's, clears abandoned games. */
export const gamehubDaily = onSchedule(
  { ...jobOptions, schedule: "0 0 * * *", timeZone: "UTC" },
  () => runDailyRollover(MAINNET),
);
export const gamehubDailyStaging = onSchedule(
  { ...jobOptions, schedule: "0 0 * * *", timeZone: "UTC" },
  () => runDailyRollover(DEVNET),
);

/** Closes the week and cuts the prize snapshot a human then pays out. */
export const gamehubWeekly = onSchedule(
  { ...jobOptions, schedule: "5 0 * * 1", timeZone: "UTC" },
  () => runWeeklyRollover(MAINNET),
);
export const gamehubWeeklyStaging = onSchedule(
  { ...jobOptions, schedule: "5 0 * * 1", timeZone: "UTC" },
  () => runWeeklyRollover(DEVNET),
);

/** Credits a day of staking points and refreshes stored ranks. */
export const gamehubStakeSnapshot = onSchedule(
  { ...jobOptions, schedule: "30 0 * * *", timeZone: "UTC" },
  () => runStakeSnapshot(MAINNET),
);
export const gamehubStakeSnapshotStaging = onSchedule(
  { ...jobOptions, schedule: "30 0 * * *", timeZone: "UTC" },
  () => runStakeSnapshot(DEVNET),
);

/** Opens hunts when their start time arrives and closes them when it's over. */
export const gamehubHuntLifecycle = onSchedule(
  { ...jobOptions, schedule: "*/5 * * * *", timeZone: "UTC" },
  () => runHuntTick(MAINNET),
);
export const gamehubHuntLifecycleStaging = onSchedule(
  { ...jobOptions, schedule: "*/5 * * * *", timeZone: "UTC" },
  () => runHuntTick(DEVNET),
);
