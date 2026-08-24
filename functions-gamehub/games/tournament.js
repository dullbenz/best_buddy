/**
 * Fetch Tournament — asynchronous head-to-head.
 *
 * Two wallets play the same three throws: same seed, same wind, same starting
 * position for Buddy. Nobody has to be online at the same time, which is the
 * only way a match format works for a community spread across every timezone.
 * The match resolves the moment the second player finishes.
 *
 * Matches carry their own throw budget rather than spending the daily fetch
 * allowance, so accepting a challenge never costs a player their streak run.
 */
import { randomBytes } from "node:crypto";

import { simulateThrow, describeField } from "../core/fetch-sim.js";
import { SIM_VERSION } from "../core/version.js";
import { boardId, col, doc, db, FieldValue } from "../db.js";
import { awardPoints, publishFeed } from "../points.js";
import {
  badRequest,
  conflict,
  forbidden,
  handler,
  notFound,
  requireRequestId,
  runIdempotent,
} from "../middleware.js";
import { parseAddress } from "../auth.js";

const THROWS_PER_MATCH = 3;
const CHALLENGE_TTL_MS = 48 * 3600 * 1000;
const WIN_POINTS = 150;
const DRAW_POINTS = 60;
const LOSS_POINTS = 25;

function challengeShape(data, viewer) {
  const opponent = data.from === viewer ? data.to : data.from;
  const mine = data.scores?.[viewer] || null;
  const theirs = opponent ? data.scores?.[opponent] || null : null;
  return {
    challengeId: data.challengeId,
    from: data.from,
    to: data.to,
    opponent,
    status: data.status,
    seed: data.status === "open" && data.from !== viewer ? null : data.seed,
    yourScore: mine ? mine.points : null,
    yourThrows: mine ? mine.throwsUsed : 0,
    theirScore: theirs && data.status === "scored" ? theirs.points : null,
    winner: data.winner || null,
    createdAtMs: data.createdAtMs,
    expiresAtMs: data.createdAtMs + CHALLENGE_TTL_MS,
    // Whose move it is, which is the only thing the match list really needs.
    yourTurn:
      (data.status === "open" || data.status === "accepted") &&
      (!mine || mine.throwsUsed < THROWS_PER_MATCH) &&
      (data.to === viewer || data.from === viewer),
  };
}

export async function createChallenge(cluster, wallet, opponentAddress) {
  if (opponentAddress !== null && opponentAddress !== undefined) {
    if (!parseAddress(opponentAddress)) {
      throw badRequest("BAD_OPPONENT", "That is not a Solana address.");
    }
    if (opponentAddress === wallet) {
      throw badRequest("SELF_CHALLENGE", "You cannot challenge yourself.");
    }
  }

  const challengeId = randomBytes(12).toString("hex");
  const now = Date.now();
  const record = {
    challengeId,
    from: wallet,
    to: opponentAddress || null,
    seed: randomBytes(32).toString("hex"),
    simVersion: SIM_VERSION,
    // "open" means anyone may claim it; "accepted" means both seats are taken.
    status: opponentAddress ? "accepted" : "open",
    scores: {},
    winner: null,
    createdAtMs: now,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(now + CHALLENGE_TTL_MS),
  };

  await doc(cluster, "challenges", challengeId).set(record);
  return challengeShape(record, wallet);
}

export async function acceptChallenge(cluster, wallet, challengeId) {
  const ref = doc(cluster, "challenges", challengeId);
  const record = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound("NO_CHALLENGE", "That challenge is gone.");
    const data = snapshot.data();

    if (data.from === wallet) throw badRequest("SELF_CHALLENGE", "That is your own challenge.");
    if (data.to && data.to !== wallet) {
      throw forbidden("NOT_YOURS", "That challenge was issued to someone else.");
    }
    if (data.status === "scored") throw conflict("ALREADY_SCORED", "That match is over.");
    if (data.createdAtMs + CHALLENGE_TTL_MS < Date.now()) {
      throw conflict("EXPIRED", "That challenge expired.");
    }

    if (!data.to) tx.update(ref, { to: wallet, status: "accepted" });
    return { ...data, to: data.to || wallet, status: "accepted" };
  });

  return challengeShape(record, wallet);
}

/** The match's current state for one player, including the field to draw. */
export async function matchState(cluster, wallet, challengeId) {
  const snapshot = await doc(cluster, "challenges", challengeId).get();
  if (!snapshot.exists) throw notFound("NO_CHALLENGE", "That challenge is gone.");
  const data = snapshot.data();
  if (data.from !== wallet && data.to !== wallet) {
    throw forbidden("NOT_YOURS", "That match is not yours.");
  }
  const shape = challengeShape(data, wallet);
  return {
    ...shape,
    throwsPerMatch: THROWS_PER_MATCH,
    simVersion: SIM_VERSION,
    field: describeField(data.seed, shape.yourThrows),
  };
}

export async function takeMatchThrow(
  cluster,
  { wallet, uid, requestId, challengeId, angleQ, powerQ },
) {
  const ref = doc(cluster, "challenges", challengeId);

  const { response } = await runIdempotent(cluster, uid, requestId, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound("NO_CHALLENGE", "That challenge is gone.");
    const data = snapshot.data();

    if (data.from !== wallet && data.to !== wallet) {
      throw forbidden("NOT_YOURS", "That match is not yours.");
    }
    if (data.simVersion !== SIM_VERSION) {
      throw conflict("SIM_CHANGED", "The game was updated mid-match. This one is void.");
    }
    if (data.createdAtMs + CHALLENGE_TTL_MS < Date.now()) {
      throw conflict("EXPIRED", "That challenge expired.");
    }

    const mine = data.scores?.[wallet] || { points: 0, throwsUsed: 0, perfectStreak: 0, throws: [] };
    if (mine.throwsUsed >= THROWS_PER_MATCH) {
      throw conflict("MATCH_DONE", "You have taken all three throws.");
    }

    const throwIndex = mine.throwsUsed;
    const outcome = simulateThrow(
      data.seed,
      throwIndex,
      { angleQ, powerQ },
      // No Golden Bone in a match: both players face identical conditions, and
      // a staking perk that changed the scoring would make that untrue.
      { mode: "normal", perfectStreak: mine.perfectStreak },
    );

    const updated = {
      points: mine.points + outcome.points,
      throwsUsed: throwIndex + 1,
      perfectStreak: outcome.grade === "perfect" ? mine.perfectStreak + 1 : 0,
      throws: [
        ...(mine.throws || []),
        { index: throwIndex, grade: outcome.grade, points: outcome.points },
      ],
    };

    const scores = { ...(data.scores || {}), [wallet]: updated };
    const opponent = data.from === wallet ? data.to : data.from;
    const theirs = opponent ? scores[opponent] : null;

    const bothDone =
      opponent &&
      updated.throwsUsed >= THROWS_PER_MATCH &&
      theirs &&
      theirs.throwsUsed >= THROWS_PER_MATCH;

    let winner = null;
    let resolved = false;
    if (bothDone) {
      resolved = true;
      if (updated.points > theirs.points) winner = wallet;
      else if (theirs.points > updated.points) winner = opponent;
      else winner = "draw";
    }

    tx.update(ref, {
      scores,
      status: resolved ? "scored" : data.status,
      winner,
      resolvedAt: resolved ? FieldValue.serverTimestamp() : null,
    });

    if (resolved) {
      // Both players are settled here, in this transaction, so a match can
      // never pay out one side and lose the other to a failure.
      const forWallet = winner === "draw" ? DRAW_POINTS : winner === wallet ? WIN_POINTS : LOSS_POINTS;
      const forOpponent =
        winner === "draw" ? DRAW_POINTS : winner === opponent ? WIN_POINTS : LOSS_POINTS;

      awardPoints(tx, cluster, {
        wallet,
        game: "tournament",
        points: forWallet,
        boards: [boardId("tournament", "season", "1")],
        profile: {
          wins: FieldValue.increment(winner === wallet ? 1 : 0),
          losses: FieldValue.increment(winner === opponent ? 1 : 0),
          draws: FieldValue.increment(winner === "draw" ? 1 : 0),
        },
      });
      awardPoints(tx, cluster, {
        wallet: opponent,
        game: "tournament",
        points: forOpponent,
        boards: [boardId("tournament", "season", "1")],
        profile: {
          wins: FieldValue.increment(winner === opponent ? 1 : 0),
          losses: FieldValue.increment(winner === wallet ? 1 : 0),
          draws: FieldValue.increment(winner === "draw" ? 1 : 0),
        },
      });

      publishFeed(tx, cluster, {
        wallet: winner === "draw" ? wallet : winner,
        game: "tournament",
        type: "challengeResolved",
        text:
          winner === "draw"
            ? "drew a fetch match"
            : `won a fetch match ${Math.max(updated.points, theirs.points)}-${Math.min(updated.points, theirs.points)}`,
        points: null,
      });
    }

    return {
      grade: outcome.grade,
      label: outcome.label,
      points: outcome.points,
      throwIndex,
      throwsUsed: updated.throwsUsed,
      throwsPerMatch: THROWS_PER_MATCH,
      yourScore: updated.points,
      resolved,
      winner,
      theirScore: resolved ? theirs.points : null,
      flight: outcome.flight,
      field: outcome.field,
      buddy: outcome.buddy,
      nextField:
        updated.throwsUsed < THROWS_PER_MATCH
          ? describeField(data.seed, updated.throwsUsed)
          : null,
    };
  });

  return response;
}

export function mountTournamentRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/tournament/challenge",
    rateLimits.game,
    handler(async (req, res) => {
      res.json(await createChallenge(cluster, req.session.wallet, req.body?.opponent ?? null));
    }),
  );

  app.post(
    "/tournament/accept",
    rateLimits.game,
    handler(async (req, res) => {
      const challengeId = req.body?.challengeId;
      if (typeof challengeId !== "string") throw badRequest("BAD_CHALLENGE", "Which challenge?");
      res.json(await acceptChallenge(cluster, req.session.wallet, challengeId));
    }),
  );

  app.get(
    "/tournament/match/:challengeId",
    handler(async (req, res) => {
      res.json(await matchState(cluster, req.session.wallet, req.params.challengeId));
    }),
  );

  app.post(
    "/tournament/throw",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const challengeId = req.body?.challengeId;
      const angleQ = Number(req.body?.angleQ);
      const powerQ = Number(req.body?.powerQ);
      if (typeof challengeId !== "string") throw badRequest("BAD_CHALLENGE", "Which challenge?");
      if (!Number.isFinite(angleQ) || !Number.isFinite(powerQ)) {
        throw badRequest("BAD_THROW", "A throw needs an angle and a power.");
      }
      res.json(
        await takeMatchThrow(cluster, {
          wallet: req.session.wallet,
          uid: req.session.uid,
          requestId,
          challengeId,
          angleQ: Math.trunc(angleQ),
          powerQ: Math.trunc(powerQ),
        }),
      );
    }),
  );

  app.get(
    "/tournament/mine",
    handler(async (req, res) => {
      const wallet = req.session.wallet;
      const [fromMe, toMe, open] = await Promise.all([
        col(cluster, "challenges").where("from", "==", wallet).orderBy("createdAtMs", "desc").limit(25).get(),
        col(cluster, "challenges").where("to", "==", wallet).orderBy("createdAtMs", "desc").limit(25).get(),
        col(cluster, "challenges")
          .where("status", "==", "open")
          .orderBy("createdAtMs", "desc")
          .limit(15)
          .get(),
      ]);

      const seen = new Set();
      const mine = [];
      for (const snapshot of [...fromMe.docs, ...toMe.docs]) {
        if (seen.has(snapshot.id)) continue;
        seen.add(snapshot.id);
        mine.push(challengeShape(snapshot.data(), wallet));
      }
      mine.sort((a, b) => b.createdAtMs - a.createdAtMs);

      res.json({
        yourTurn: mine.filter((match) => match.yourTurn && match.status !== "scored"),
        waiting: mine.filter((match) => !match.yourTurn && match.status !== "scored"),
        history: mine.filter((match) => match.status === "scored"),
        openChallenges: open.docs
          .map((snapshot) => challengeShape(snapshot.data(), wallet))
          .filter((match) => match.from !== wallet),
        throwsPerMatch: THROWS_PER_MATCH,
      });
    }),
  );
}

export async function expireStaleChallenges(cluster) {
  const cutoff = Date.now() - CHALLENGE_TTL_MS;
  const stale = await col(cluster, "challenges")
    .where("status", "in", ["open", "accepted"])
    .where("createdAtMs", "<", cutoff)
    .limit(200)
    .get();

  const batch = db().batch();
  for (const snapshot of stale.docs) {
    batch.update(snapshot.ref, { status: "expired" });
  }
  if (!stale.empty) await batch.commit();
  return stale.size;
}
