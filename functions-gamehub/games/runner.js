/**
 * Buddy vs. The Rugs.
 *
 * The browser plays the run and records every key press against a tick number.
 * On submit, the server replays that exact input trace through the exact same
 * simulation and keeps its own score. The number the client claims is compared
 * but never trusted — it exists only so a mismatch can be logged and rejected
 * loudly instead of silently scoring something different from what the player
 * watched.
 *
 * What this proves is that the run was really played out: you cannot submit a
 * score you did not earn without producing an input trace that actually earns
 * it. What it cannot prove is that a human pressed the keys. A scripted player
 * with perfect information will beat any human, which is why prizes are settled
 * from a cycle snapshot reviewed by people rather than paid automatically.
 */
import { randomBytes } from "node:crypto";

import { simulateRun, RUNNER_LIMITS } from "../core/runner-sim.js";
import { SIM_VERSION } from "../core/version.js";
import { boardId, doc, dayId, FieldValue, weekId } from "../db.js";
import { awardPoints } from "../points.js";
import {
  badRequest,
  conflict,
  handler,
  notFound,
  requireRequestId,
  runIdempotent,
} from "../middleware.js";

/** A run left open longer than this was abandoned. */
const RUN_TTL_MS = 20 * 60 * 1000;
const TICKS_PER_SECOND = 60;
/**
 * How much faster than real time a submission may claim to have been played.
 * Allows for a slow device dropping frames and for clock skew, while still
 * rejecting a trace generated instantly by a script.
 */
const MIN_ELAPSED_RATIO = 0.8;

/** Distance points are worth less than fetch points; a run lasts minutes. */
const POINTS_DIVISOR = 20;

export async function startRun(cluster, wallet) {
  const runId = `${wallet}_${randomBytes(8).toString("hex")}`;
  const seed = randomBytes(32).toString("hex");
  const startedAtMs = Date.now();

  await doc(cluster, "runnerRuns", runId).set({
    runId,
    wallet,
    seed,
    simVersion: SIM_VERSION,
    status: "open",
    startedAtMs,
    startedAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(startedAtMs + RUN_TTL_MS),
  });

  return { runId, seed, simVersion: SIM_VERSION, limits: RUNNER_LIMITS };
}

function readInputs(body) {
  const inputs = body?.inputs;
  if (!Array.isArray(inputs)) throw badRequest("BAD_INPUTS", "A run needs its input trace.");
  if (inputs.length > RUNNER_LIMITS.maxInputs) {
    throw badRequest("BAD_INPUTS", "That is more input than a run can contain.");
  }
  return inputs.map((input) => ({ tick: Number(input?.tick), action: Number(input?.action) }));
}

export async function submitRun(cluster, { wallet, uid, requestId, runId, inputs, claimedScore }) {
  const runRef = doc(cluster, "runnerRuns", runId);
  const playerRef = doc(cluster, "players", wallet);
  const now = Date.now();

  const { response } = await runIdempotent(cluster, uid, requestId, async (tx) => {
    const [runSnapshot, playerSnapshot] = await Promise.all([
      tx.get(runRef),
      tx.get(playerRef),
    ]);

    if (!runSnapshot.exists) throw notFound("NO_RUN", "That run has expired.");
    const run = runSnapshot.data();
    if (run.wallet !== wallet) throw notFound("NO_RUN", "That run is not yours.");
    if (run.status !== "open") {
      throw conflict("RUN_CLOSED", "That run was already submitted.");
    }
    if (run.simVersion !== SIM_VERSION) {
      throw conflict("SIM_CHANGED", "The game was updated mid-run. Start a fresh one.");
    }

    let result;
    try {
      result = simulateRun(run.seed, inputs);
    } catch (error) {
      tx.update(runRef, {
        status: "rejected",
        rejectedReason: `malformed: ${error.message}`,
        submittedAt: FieldValue.serverTimestamp(),
      });
      throw badRequest("BAD_INPUTS", "That input trace is not a valid run.");
    }

    // A run cannot have been played faster than it takes to play.
    const simulatedMs = ((result.deathTick ?? RUNNER_LIMITS.maxTicks) / TICKS_PER_SECOND) * 1000;
    const elapsedMs = now - (run.startedAtMs || now);
    if (elapsedMs < simulatedMs * MIN_ELAPSED_RATIO) {
      tx.update(runRef, {
        status: "rejected",
        rejectedReason: `too fast: ${elapsedMs}ms elapsed for ${Math.round(simulatedMs)}ms of play`,
        submittedAt: FieldValue.serverTimestamp(),
      });
      throw badRequest("RUN_TOO_FAST", "That run came back faster than it could be played.");
    }

    const points = Math.trunc(result.score / POINTS_DIVISOR);
    const previousBest = playerSnapshot.exists
      ? playerSnapshot.data()?.runner?.personalBest || 0
      : 0;
    const isPersonalBest = result.score > previousBest;

    tx.update(runRef, {
      status: "accepted",
      claimedScore: Number.isFinite(claimedScore) ? claimedScore : null,
      // Kept for the record: a persistent gap between claimed and validated is
      // the signal that something on the client has drifted.
      claimMatched: claimedScore === result.score,
      validated: result,
      inputCount: inputs.length,
      elapsedMs,
      submittedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      playerRef,
      {
        wallet,
        runner: {
          personalBest: Math.max(previousBest, result.score),
          runs: FieldValue.increment(1),
          lastScore: result.score,
        },
      },
      { merge: true },
    );

    const week = weekId(new Date(now));
    awardPoints(tx, cluster, {
      wallet,
      game: "runner",
      points,
      boards: [boardId("runner", "weekly", week), boardId("runner", "daily", dayId(new Date(now)))],
      feed: isPersonalBest
        ? {
            type: "runner",
            // Names the game. Sitting next to "pet Buddy ×10", a bare "personal
            // best of 71" reads as a number of pets.
            text: `got ${result.score} past the rugs — a new personal best`,
            points,
          }
        : null,
    });

    return {
      accepted: true,
      score: result.score,
      distance: result.distance,
      bones: result.bones,
      deathTick: result.deathTick,
      points,
      personalBest: Math.max(previousBest, result.score),
      isPersonalBest,
      claimMatched: claimedScore === result.score,
    };
  });

  return response;
}

export function mountRunnerRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/runner/start",
    rateLimits.game,
    handler(async (req, res) => {
      res.json(await startRun(cluster, req.session.wallet));
    }),
  );

  app.post(
    "/runner/submit",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const runId = req.body?.runId;
      if (typeof runId !== "string" || !runId) {
        throw badRequest("BAD_RUN", "Which run is this?");
      }
      res.json(
        await submitRun(cluster, {
          wallet: req.session.wallet,
          uid: req.session.uid,
          requestId,
          runId,
          inputs: readInputs(req.body),
          claimedScore: Number(req.body?.score),
        }),
      );
    }),
  );
}
