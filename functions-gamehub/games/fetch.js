/**
 * Buddy's Daily Fetch.
 *
 * Three scored throws a day, plus unlimited practice the server never hears
 * about. The client sends only where it aimed and how hard; the grade is
 * computed here, from the same simulation the browser animated, against a seed
 * the server issued. A client that reports its own score is not trusted with
 * one.
 *
 * Streaks are the retention mechanic and are tracked here rather than in the
 * browser for the obvious reason.
 */
import { randomBytes } from "node:crypto";

import { simulateThrow, describeField } from "../core/fetch-sim.js";
import { SIM_VERSION } from "../core/version.js";
import {
  boardId,
  dayId,
  doc,
  db,
  FieldValue,
  nextDayBoundary,
  readConfig,
  streakMultiplierX100,
  weekId,
} from "../db.js";
import { awardPoints } from "../points.js";
import {
  badRequest,
  conflict,
  handler,
  notFound,
  requireRequestId,
  runIdempotent,
} from "../middleware.js";
import { getStakeStatus } from "../stake.js";

const ROUND_TTL_MS = 60 * 60 * 1000;

function newSeed() {
  return randomBytes(32).toString("hex");
}

/** Yesterday's day id, for deciding whether a streak survived. */
function previousDayId(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dayId(date);
}

/**
 * The player's fetch state for today, with the streak already rolled forward.
 * Pure: callers decide whether to persist it.
 */
export function todayState(playerData, day) {
  const fetch = playerData?.fetch || {};
  if (fetch.day === day) {
    return {
      day,
      throwsUsed: fetch.throwsUsed || 0,
      todayPoints: fetch.todayPoints || 0,
      perfectStreak: fetch.perfectStreak || 0,
      streakDays: fetch.streakDays || 0,
      roundId: fetch.roundId || null,
      countedToday: true,
    };
  }

  // First scored throw of a new day: the streak continues only if they played
  // yesterday, otherwise it starts over at one.
  const playedYesterday = fetch.day === previousDayId(day);
  return {
    day,
    throwsUsed: 0,
    todayPoints: 0,
    perfectStreak: 0,
    streakDays: playedYesterday ? (fetch.streakDays || 0) + 1 : 1,
    roundId: null,
    countedToday: false,
  };
}

/**
 * Open (or resume) today's round.
 *
 * The seed is fixed for the day, so the three throws share a field and a player
 * cannot reroll conditions by restarting. Golden Bone is decided here, once,
 * and recorded on the round: a stake acquired mid-round does not retroactively
 * upgrade throws already taken.
 */
export async function startRound(cluster, wallet, { context = "daily" } = {}) {
  const config = await readConfig(cluster);
  const now = new Date();
  const day = dayId(now);

  const stake = await getStakeStatus(cluster, wallet);
  const mode = stake.staked ? "golden" : "normal";

  const playerRef = doc(cluster, "players", wallet);

  const result = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(playerRef);
    const state = todayState(snapshot.exists ? snapshot.data() : {}, day);

    if (state.throwsUsed >= config.fetchThrowsPerDay) {
      throw conflict("NO_THROWS_LEFT", "That's your three for today. Come back tomorrow.", {
        resetsAt: nextDayBoundary(now).toISOString(),
        streakDays: state.streakDays,
      });
    }

    let roundId = state.roundId;
    let seed;
    if (roundId) {
      const existing = await tx.get(doc(cluster, "fetchRounds", roundId));
      seed = existing.exists ? existing.data().seed : null;
      if (!seed) roundId = null;
    }

    if (!roundId) {
      roundId = `${wallet}_${day}_${randomBytes(6).toString("hex")}`;
      seed = newSeed();
      tx.set(doc(cluster, "fetchRounds", roundId), {
        roundId,
        wallet,
        day,
        seed,
        mode,
        context,
        simVersion: SIM_VERSION,
        throws: [],
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + ROUND_TTL_MS),
      });
    }

    tx.set(
      playerRef,
      {
        wallet,
        fetch: {
          day,
          roundId,
          throwsUsed: state.throwsUsed,
          todayPoints: state.todayPoints,
          perfectStreak: state.perfectStreak,
          streakDays: state.streakDays,
        },
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { roundId, seed, state };
  });

  const multiplierX100 = streakMultiplierX100(config, result.state.streakDays);
  return {
    roundId: result.roundId,
    seed: result.seed,
    mode,
    simVersion: SIM_VERSION,
    throwIndex: result.state.throwsUsed,
    throwsRemaining: config.fetchThrowsPerDay - result.state.throwsUsed,
    throwsPerDay: config.fetchThrowsPerDay,
    streakDays: result.state.streakDays,
    multiplierX100,
    todayPoints: result.state.todayPoints,
    resetsAt: nextDayBoundary(now).toISOString(),
    goldenEligible: stake.staked,
    // Handed over so the client can draw the field before the first throw.
    field: describeField(result.seed, result.state.throwsUsed),
  };
}

/**
 * Score one throw.
 *
 * The whole outcome is recomputed here. The client's animation is a
 * presentation of this result, not an input to it.
 */
export async function takeThrow(cluster, { wallet, uid, requestId, roundId, angleQ, powerQ }) {
  const config = await readConfig(cluster);
  const now = new Date();
  const day = dayId(now);
  const week = weekId(now);

  const roundRef = doc(cluster, "fetchRounds", roundId);
  const playerRef = doc(cluster, "players", wallet);

  const { response } = await runIdempotent(cluster, uid, requestId, async (tx) => {
    const [roundSnapshot, playerSnapshot] = await Promise.all([
      tx.get(roundRef),
      tx.get(playerRef),
    ]);

    if (!roundSnapshot.exists) throw notFound("NO_ROUND", "That round has gone. Start a new one.");
    const round = roundSnapshot.data();
    if (round.wallet !== wallet) throw notFound("NO_ROUND", "That round is not yours.");
    if (round.simVersion !== SIM_VERSION) {
      throw conflict("SIM_CHANGED", "The game was updated mid-round. Start a fresh one.");
    }

    const state = todayState(playerSnapshot.exists ? playerSnapshot.data() : {}, day);
    if (round.day !== day) {
      throw conflict("ROUND_EXPIRED", "That round was yesterday's. Start a new one.");
    }
    if (state.throwsUsed >= config.fetchThrowsPerDay) {
      throw conflict("NO_THROWS_LEFT", "That's your three for today.", {
        resetsAt: nextDayBoundary(now).toISOString(),
      });
    }

    const throwIndex = state.throwsUsed;
    const outcome = simulateThrow(
      round.seed,
      throwIndex,
      { angleQ, powerQ },
      { mode: round.mode, perfectStreak: state.perfectStreak },
    );

    // Streak multiplier applies to the whole throw, combo bonus included.
    const multiplierX100 = streakMultiplierX100(config, state.streakDays);
    const points = Math.trunc((outcome.points * multiplierX100) / 100);
    const perfectStreak = outcome.grade === "perfect" ? state.perfectStreak + 1 : 0;

    tx.update(roundRef, {
      throws: FieldValue.arrayUnion({
        index: throwIndex,
        angleQ,
        powerQ,
        grade: outcome.grade,
        base: outcome.points,
        points,
      }),
    });

    tx.set(
      playerRef,
      {
        wallet,
        fetch: {
          day,
          roundId,
          throwsUsed: throwIndex + 1,
          todayPoints: state.todayPoints + points,
          perfectStreak,
          streakDays: state.streakDays,
          longestStreak: Math.max(
            state.streakDays,
            playerSnapshot.exists ? playerSnapshot.data()?.fetch?.longestStreak || 0 : 0,
          ),
        },
      },
      { merge: true },
    );

    // A daily round belongs on the boards; a tournament round is scored by the
    // match instead, so it stays off them.
    const boards =
      round.context === "daily"
        ? [boardId("fetch", "weekly", week), boardId("fetch", "daily", day)]
        : [];

    awardPoints(tx, cluster, {
      wallet,
      game: "fetch",
      points,
      boards,
      feed:
        outcome.grade === "perfect"
          ? { type: "fetch", text: "made a perfect catch", points }
          : null,
    });

    return {
      grade: outcome.grade,
      label: outcome.label,
      base: outcome.base,
      comboBonus: outcome.comboBonus,
      multiplierX100,
      points,
      throwIndex,
      throwsRemaining: config.fetchThrowsPerDay - (throwIndex + 1),
      todayPoints: state.todayPoints + points,
      streakDays: state.streakDays,
      perfectStreak,
      resetsAt: nextDayBoundary(now).toISOString(),
      // Everything the client needs to replay the throw it just made.
      flight: outcome.flight,
      field: outcome.field,
      buddy: outcome.buddy,
      // The next field, so the stage can reset without another round trip.
      nextField:
        throwIndex + 1 < config.fetchThrowsPerDay
          ? describeField(round.seed, throwIndex + 1)
          : null,
    };
  });

  return response;
}

function readThrowInput(req) {
  const angleQ = Number(req.body?.angleQ);
  const powerQ = Number(req.body?.powerQ);
  const roundId = req.body?.roundId;
  if (!Number.isFinite(angleQ) || !Number.isFinite(powerQ)) {
    throw badRequest("BAD_THROW", "A throw needs an angle and a power.");
  }
  if (typeof roundId !== "string" || !roundId) {
    throw badRequest("BAD_ROUND", "Which round is this throw for?");
  }
  return { roundId, angleQ: Math.trunc(angleQ), powerQ: Math.trunc(powerQ) };
}

export function mountFetchRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/fetch/start",
    rateLimits.game,
    handler(async (req, res) => {
      res.json(await startRound(cluster, req.session.wallet));
    }),
  );

  app.post(
    "/fetch/throw",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const input = readThrowInput(req);
      res.json(
        await takeThrow(cluster, {
          wallet: req.session.wallet,
          uid: req.session.uid,
          requestId,
          ...input,
        }),
      );
    }),
  );

  app.get(
    "/fetch/state",
    handler(async (req, res) => {
      const config = await readConfig(cluster);
      const now = new Date();
      const day = dayId(now);
      const [playerSnapshot, stake] = await Promise.all([
        doc(cluster, "players", req.session.wallet).get(),
        getStakeStatus(cluster, req.session.wallet),
      ]);
      const state = todayState(playerSnapshot.exists ? playerSnapshot.data() : {}, day);
      res.json({
        throwsRemaining: config.fetchThrowsPerDay - state.throwsUsed,
        throwsPerDay: config.fetchThrowsPerDay,
        todayPoints: state.todayPoints,
        streakDays: state.streakDays,
        multiplierX100: streakMultiplierX100(config, state.streakDays),
        goldenEligible: stake.staked,
        resetsAt: nextDayBoundary(now).toISOString(),
      });
    }),
  );
}
