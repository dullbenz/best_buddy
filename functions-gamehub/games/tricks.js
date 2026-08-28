/**
 * New Tricks — creator-made games.
 *
 * A trick is authored content, never code: a quiz, a word scramble, or an
 * emoji riddle, validated against one of the fixed templates and stored as
 * data. The split mirrors hunts, which is the security model: `tricks/{id}`
 * carries what every player may see, `tricksPrivate/{id}` carries the
 * answers, and no client can read the private half — what differs from hunts
 * is that the private doc keeps plaintext alongside the salted hash, because
 * a finished attempt reveals the answers and a scramble has to be derived
 * from them. The load-bearing property — answers never reach the bundle or
 * any client-readable document — holds either way.
 *
 * Sessions here may be guests. A guest lands on the trick boards through
 * `creditBoard` but never reaches `awardPoints`: the GBP ledger and profiles
 * stay strictly wallet-keyed.
 */
import { randomBytes } from "node:crypto";

import { col, doc, db, dayId, weekId, boardId, FieldValue, readConfig } from "../db.js";
import { awardPoints, creditBoard, publishFeed } from "../points.js";
import {
  badRequest,
  conflict,
  forbidden,
  handler,
  notFound,
  requireRequestId,
  runIdempotent,
  tooMany,
} from "../middleware.js";
import { parseAddress } from "../auth.js";
// Circular with jobs.js (which imports the judging helpers above) — safe
// because both sides export hoisted function declarations used at request
// time, never during module initialisation.
import { computeArtifactSha } from "../jobs.js";
import { normalizeAnswer, hashSecret, newSalt } from "./hunt.js";
import {
  TRICKS_SIM_VERSION,
  TRICKS_LIMITS,
  scrambleWord,
  clampTicks,
  scoreTrick,
} from "../core/tricks-sim.js";

const TRICK_ID_PATTERN = /^[0-9a-f]{24}$/;

function requireTrickId(value) {
  if (!TRICK_ID_PATTERN.test(String(value || ""))) {
    throw badRequest("BAD_TRICK_ID", "That is not a trick id.");
  }
  return value;
}

function capped(value, max, field) {
  const text = String(value ?? "").trim();
  if (text.length > max) {
    throw badRequest("TOO_LONG", `${field} must be at most ${max} characters.`);
  }
  return text;
}

/**
 * Turn an authored trick into its public half and its private half.
 *
 * Ids are minted here, never client-chosen, so there is nothing to squat.
 * Validation is strict and boring on purpose: every string is capped, counts
 * must sit inside the template bounds, and the payout address must decode —
 * it is a destination, not an identity, and is never asked to prove anything.
 */
export function prepareTrick(input, playerId) {
  const template = input?.template;
  if (!TRICKS_LIMITS.templates.includes(template)) {
    throw badRequest("BAD_TEMPLATE", `Template must be one of: ${TRICKS_LIMITS.templates.join(", ")}.`);
  }

  const title = capped(input.title, TRICKS_LIMITS.titleMax, "title");
  if (!title) throw badRequest("NO_TITLE", "A trick needs a title.");
  const intro = capped(input.intro, TRICKS_LIMITS.introMax, "intro");

  const payoutWallet = String(input.payoutWallet || "").trim();
  if (!parseAddress(payoutWallet)) {
    throw badRequest("BAD_PAYOUT", "The payout address is not a Solana address.");
  }

  const bounds = TRICKS_LIMITS[template];
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length < bounds.minItems || items.length > bounds.maxItems) {
    throw badRequest(
      "BAD_ITEM_COUNT",
      `A ${template} needs ${bounds.minItems}-${bounds.maxItems} items.`,
    );
  }

  const publicItems = [];
  const privateItems = [];
  items.forEach((item, index) => {
    const label = `item ${index + 1}`;
    if (template === "quiz") {
      const prompt = capped(item?.prompt, bounds.promptMax, `${label} prompt`);
      if (!prompt) throw badRequest("NO_PROMPT", `${label} has no prompt.`);
      const options = Array.isArray(item?.options) ? item.options : [];
      if (options.length < bounds.minOptions || options.length > bounds.maxOptions) {
        throw badRequest(
          "BAD_OPTIONS",
          `${label} needs ${bounds.minOptions}-${bounds.maxOptions} options.`,
        );
      }
      const cleaned = options.map((option, optionIndex) => {
        const text = capped(option, bounds.optionMax, `${label} option ${optionIndex + 1}`);
        if (!text) throw badRequest("NO_OPTION", `${label} has an empty option.`);
        return text;
      });
      const answer = item?.answer;
      if (!Number.isInteger(answer) || answer < 0 || answer >= cleaned.length) {
        throw badRequest("BAD_ANSWER", `${label} must name one of its options as the answer.`);
      }
      publicItems.push({ prompt, options: cleaned });
      privateItems.push({ answerIndex: answer });
      return;
    }

    if (template === "scramble") {
      const word = String(item?.word || "").trim().toLowerCase();
      if (!new RegExp(`^[a-z]{${bounds.wordMin},${bounds.wordMax}}$`).test(word)) {
        throw badRequest(
          "BAD_WORD",
          `${label} must be a single word of ${bounds.wordMin}-${bounds.wordMax} letters.`,
        );
      }
      const hint = capped(item?.hint, bounds.hintMax, `${label} hint`);
      const salt = newSalt();
      // Length is public so the player sees the right number of blanks; the
      // letters themselves only exist scrambled, derived at start time.
      publicItems.push({ hint: hint || null, length: word.length });
      privateItems.push({ answer: word, display: word, salt, answerHash: hashSecret(salt, word) });
      return;
    }

    // riddle
    const emoji = String(item?.emoji || "").trim();
    const codePoints = Array.from(emoji).length;
    if (codePoints === 0 || codePoints > bounds.emojiMaxCodePoints) {
      throw badRequest("BAD_EMOJI", `${label} needs 1-${bounds.emojiMaxCodePoints} characters of emoji.`);
    }
    const answer = capped(item?.answer, bounds.answerMax, `${label} answer`);
    if (!normalizeAnswer(answer)) {
      throw badRequest("NO_ANSWER", `${label} has no usable answer.`);
    }
    const hint = capped(item?.hint, bounds.hintMax, `${label} hint`);
    const salt = newSalt();
    publicItems.push({ emoji, hint: hint || null });
    privateItems.push({ answer, display: answer, salt, answerHash: hashSecret(salt, answer) });
  });

  const trickId = randomBytes(12).toString("hex");
  return {
    trickId,
    publicDoc: {
      trickId,
      template,
      title,
      intro,
      status: "pending",
      createdByPlayer: playerId,
      payoutWallet,
      items: publicItems,
      itemCount: publicItems.length,
      playCount: 0,
      ratingCount: 0,
      originalitySum: 0,
      funSum: 0,
      reportCount: 0,
      // Per-ISO-week {plays, raters}, so the rollover can judge "this window"
      // without a collection scan. A couple of small map entries per week of
      // life is the whole cost.
      weeklyStats: {},
      featuredWeek: null,
    },
    privateDoc: { trickId, template, items: privateItems },
  };
}

/** The shelf card: everything public about a trick except its items. */
function summarize(data) {
  return {
    trickId: data.trickId,
    template: data.template,
    title: data.title,
    intro: data.intro,
    status: data.status,
    createdByPlayer: data.createdByPlayer,
    payoutWallet: data.payoutWallet,
    itemCount: data.itemCount,
    playCount: data.playCount || 0,
    ratingCount: data.ratingCount || 0,
    originalitySum: data.originalitySum || 0,
    funSum: data.funSum || 0,
    featuredWeek: data.featuredWeek || null,
    approvedAtMs: data.approvedAtMs || null,
  };
}

/** The per-template payload a player needs beyond the public doc. */
function startExtras(publicData, privateData, seed) {
  if (publicData.template !== "scramble") return null;
  // Derived, not stored: the same seed and index always produce the same
  // letters, so a resumed attempt sees the scramble it started with.
  return privateData.items.map((item, index) => ({
    letters: scrambleWord(seed, index, item.answer),
  }));
}

/** Grade one submitted attempt against the private answers. */
function grade(template, privateItems, answers) {
  return privateItems.map((item, index) => {
    const given = answers[index];
    if (template === "quiz") return Number.isInteger(given) && given === item.answerIndex;
    if (typeof given !== "string") return false;
    return hashSecret(item.salt, given) === item.answerHash;
  });
}

/** What the finished attempt reveals. */
function revealAnswers(template, privateItems) {
  if (template === "quiz") return privateItems.map((item) => item.answerIndex);
  return privateItems.map((item) => item.display);
}

/**
 * A trick's standing, as an integer rating out of 500.
 *
 * A Bayesian mean damped toward the middle by rating volume: three 5.0s from
 * three friends must not beat forty 4.6s. The prior weighs like five full
 * ratings of 3.0 across both dimensions.
 */
const RATING_PRIOR_WEIGHT = 10;
const RATING_PRIOR_MEAN_X100 = 300;
export function trickScoreX100(data) {
  const observations = (data.ratingCount || 0) * 2;
  const sum = (data.originalitySum || 0) + (data.funSum || 0);
  return Math.floor(
    (RATING_PRIOR_WEIGHT * RATING_PRIOR_MEAN_X100 + sum * 100) /
      (RATING_PRIOR_WEIGHT + observations),
  );
}

/**
 * Rank the tricks eligible to be featured, best first. Pure, so the weekly
 * job and its tests judge with the same arithmetic.
 */
export function shortlistTricks(datas, { week, config }) {
  return datas
    .map((data) => {
      const stats = data.weeklyStats?.[week] || {};
      return {
        trickId: data.trickId,
        title: data.title,
        payoutWallet: data.payoutWallet,
        createdByPlayer: data.createdByPlayer,
        scoreX100: trickScoreX100(data),
        plays: stats.plays || 0,
        raters: stats.raters || 0,
        ratingCount: data.ratingCount || 0,
        eligible:
          data.status === "approved" &&
          !data.featuredWeek &&
          (stats.plays || 0) >= config.tricksMinPlaysToFeature &&
          (stats.raters || 0) >= config.tricksMinRatersToFeature,
      };
    })
    .filter((candidate) => candidate.eligible)
    .sort(
      (a, b) =>
        b.scoreX100 - a.scoreX100 || b.plays - a.plays || a.trickId.localeCompare(b.trickId),
    );
}

/** Every approved trick's data, for the weekly judging. */
export async function approvedTricks(cluster) {
  // 500 covers years of weekly approvals; if the shelf ever outgrows it, the
  // shortlist quietly judging a subset would be worse than this failing loud.
  const snapshot = await col(cluster, "tricks")
    .where("status", "==", "approved")
    .limit(500)
    .get();
  if (snapshot.size === 500) throw new Error("approvedTricks hit its 500 cap; page the judging");
  return snapshot.docs.map((entry) => entry.data());
}

/** Crown one trick for a week: the featured doc plus the flag on the trick. */
export async function featureTrick(cluster, { week, trickId, shortlist, prizeCycle, decidedBy }) {
  await Promise.all([
    doc(cluster, "featuredTricks", week).set({
      week,
      trickId,
      // Which prizeCycles doc carries this pick's creator reward — the
      // feature-override needs to know which snapshot to amend.
      prizeCycle: prizeCycle || null,
      shortlist: shortlist || [],
      decidedBy: decidedBy || "auto",
      decidedAt: FieldValue.serverTimestamp(),
    }),
    doc(cluster, "tricks", trickId).set({ featuredWeek: week }, { merge: true }),
  ]);
}

/** Day-rolled per-player tricks state, mirroring fetch's day fields. */
function stateFor(snapshot, day) {
  const data = snapshot.exists ? snapshot.data() : {};
  if (data.day !== day) return { day, submissions: 0, pointsAwardedToday: 0 };
  return {
    day,
    submissions: data.submissions || 0,
    pointsAwardedToday: data.pointsAwardedToday || 0,
  };
}

export function mountTricksPublicRoutes(app, cluster) {
  app.get(
    "/tricks",
    handler(async (req, res) => {
      const now = new Date();
      const week = weekId(now);
      const config = await readConfig(cluster);
      const [featuredSnapshot, approved] = await Promise.all([
        doc(cluster, "featuredTricks", week).get(),
        col(cluster, "tricks")
          .where("status", "==", "approved")
          .orderBy("approvedAtMs", "desc")
          .limit(50)
          .get(),
      ]);

      const tricks = approved.docs.map((entry) => summarize(entry.data()));
      const featuredId = featuredSnapshot.exists ? featuredSnapshot.data().trickId : null;

      res.json({
        week,
        featured: featuredId
          ? {
              trickId: featuredId,
              board: boardId("tricks", "weekly", week),
              trick: tricks.find((trick) => trick.trickId === featuredId) || null,
            }
          : null,
        tricks,
        // The client has no mirror of the server config; whatever the UI
        // needs to show rides here.
        limits: {
          attemptsPerTrickPerDay: config.tricksAttemptsPerTrickPerDay,
          submissionsPerDay: config.tricksSubmissionsPerDay,
          pointsCapPerDay: config.tricksPointsCapPerDay,
        },
      });
    }),
  );

  app.get(
    "/tricks/:trickId",
    handler(async (req, res) => {
      const trickId = requireTrickId(req.params.trickId);
      const snapshot = await doc(cluster, "tricks", trickId).get();
      if (!snapshot.exists) throw notFound("NO_TRICK", "No such trick.");
      const data = snapshot.data();

      const playerId = req.session?.wallet || null;
      const isCreator = playerId && data.createdByPlayer === playerId;
      const isAdmin = req.session?.admin === true;
      if (data.status !== "approved" && !isCreator && !isAdmin) {
        // A pending or removed trick is indistinguishable from a missing one:
        // the shelf is the only place approval is announced.
        throw notFound("NO_TRICK", "No such trick.");
      }

      let you = null;
      if (playerId) {
        const day = dayId(new Date());
        const [play, rating] = await Promise.all([
          doc(cluster, "trickPlays", `${trickId}__${playerId}__${day}`).get(),
          doc(cluster, "trickRatings", `${trickId}__${playerId}`).get(),
        ]);
        you = {
          playedToday: play.exists,
          scoredToday: play.exists && play.data().status === "scored",
          rated: rating.exists,
          isCreator: Boolean(isCreator),
        };
      }

      res.json({ trick: { ...summarize(data), items: data.items }, you });
    }),
  );
}

export function mountTricksRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/tricks/submit",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const playerId = req.session.wallet;
      const config = await readConfig(cluster);
      const { trickId, publicDoc, privateDoc } = prepareTrick(req.body || {}, playerId);

      // Advisory, read outside the transaction: the aggregation API cannot run
      // inside one, and being one over the pending cap for a heartbeat is not
      // a scoring bug the way a double-award would be.
      const pending = await col(cluster, "tricks")
        .where("createdByPlayer", "==", playerId)
        .where("status", "==", "pending")
        .count()
        .get();
      if (pending.data().count >= config.tricksPendingCap) {
        throw tooMany("PENDING_CAP", "You have enough tricks waiting for review already.");
      }

      const day = dayId(new Date());
      const stateRef = doc(cluster, "tricksState", playerId);
      const { response } = await runIdempotent(cluster, req.session.uid, requestId, async (tx) => {
        const state = stateFor(await tx.get(stateRef), day);
        if (state.submissions >= config.tricksSubmissionsPerDay) {
          throw tooMany("SUBMISSION_CAP", "That's all the tricks for today. Come back tomorrow.");
        }

        tx.set(doc(cluster, "tricks", trickId), {
          ...publicDoc,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
        });
        tx.set(doc(cluster, "tricksPrivate", trickId), {
          ...privateDoc,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          stateRef,
          { playerId, day, submissions: state.submissions + 1, pointsAwardedToday: state.pointsAwardedToday },
          { merge: true },
        );

        return { trickId, status: "pending" };
      });

      res.json(response);
    }),
  );

  app.post(
    "/tricks/:trickId/start",
    rateLimits.game,
    handler(async (req, res) => {
      const trickId = requireTrickId(req.params.trickId);
      const playerId = req.session.wallet;
      const day = dayId(new Date());
      const playRef = doc(cluster, "trickPlays", `${trickId}__${playerId}__${day}`);

      // No requestId here: the day-keyed play doc id makes start naturally
      // idempotent, the same way fetch and runner starts carry none.
      const response = await db().runTransaction(async (tx) => {
        const [trickSnapshot, privateSnapshot, playSnapshot] = await Promise.all([
          tx.get(doc(cluster, "tricks", trickId)),
          tx.get(doc(cluster, "tricksPrivate", trickId)),
          tx.get(playRef),
        ]);
        if (!trickSnapshot.exists || !privateSnapshot.exists) {
          throw notFound("NO_TRICK", "No such trick.");
        }
        const trick = trickSnapshot.data();
        if (trick.status !== "approved") throw notFound("NO_TRICK", "No such trick.");

        if (playSnapshot.exists) {
          const play = playSnapshot.data();
          if (play.status === "scored") {
            throw conflict("ALREADY_PLAYED", "One attempt a day — you've had yours.", { day });
          }
          // Resume: same seed, so the same scramble and the same score maths.
          return {
            playId: playSnapshot.id,
            seed: play.seed,
            simVersion: play.simVersion,
            itemCount: trick.itemCount,
            extras: startExtras(trick, privateSnapshot.data(), play.seed),
            resumed: true,
          };
        }

        const seed = randomBytes(32).toString("hex");
        tx.set(playRef, {
          trickId,
          playerId,
          day,
          week: weekId(new Date()),
          seed,
          simVersion: TRICKS_SIM_VERSION,
          status: "open",
          startedAtMs: Date.now(),
        });

        return {
          playId: playRef.id,
          seed,
          simVersion: TRICKS_SIM_VERSION,
          itemCount: trick.itemCount,
          extras: startExtras(trick, privateSnapshot.data(), seed),
          resumed: false,
        };
      });

      res.json(response);
    }),
  );

  app.post(
    "/tricks/:trickId/submit",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const trickId = requireTrickId(req.params.trickId);
      const playerId = req.session.wallet;
      const isGuest = req.session.guest === true;
      const config = await readConfig(cluster);
      const now = new Date();
      const day = dayId(now);
      const week = weekId(now);

      const playRef = doc(cluster, "trickPlays", `${trickId}__${playerId}__${day}`);
      const statsRef = doc(cluster, "trickPlayerStats", `${trickId}__${playerId}`);
      const stateRef = doc(cluster, "tricksState", playerId);

      const { response } = await runIdempotent(cluster, req.session.uid, requestId, async (tx) => {
        const [trickSnapshot, privateSnapshot, playSnapshot, stateSnapshot, featuredSnapshot] =
          await Promise.all([
            tx.get(doc(cluster, "tricks", trickId)),
            tx.get(doc(cluster, "tricksPrivate", trickId)),
            tx.get(playRef),
            tx.get(stateRef),
            tx.get(doc(cluster, "featuredTricks", week)),
          ]);
        if (!trickSnapshot.exists || !privateSnapshot.exists) {
          throw notFound("NO_TRICK", "No such trick.");
        }
        const trick = trickSnapshot.data();
        if (trick.status !== "approved") {
          throw conflict("TRICK_CLOSED", "That trick is not on the shelf any more.");
        }
        if (!playSnapshot.exists) throw conflict("NOT_STARTED", "Start the trick first.");
        const play = playSnapshot.data();
        if (play.status !== "open") {
          throw conflict("ALREADY_PLAYED", "One attempt a day — you've had yours.");
        }
        if (play.simVersion !== TRICKS_SIM_VERSION) {
          throw conflict("SIM_CHANGED", "The game was updated mid-attempt. Start a fresh one.");
        }

        const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
        if (!answers || answers.length !== trick.itemCount) {
          throw badRequest("BAD_ANSWERS", `Send one answer per item (${trick.itemCount}).`);
        }
        // Shape errors throw; values are clamped, never trusted.
        let clamped;
        try {
          clamped = clampTicks(req.body?.ticks, trick.itemCount);
        } catch (error) {
          throw badRequest("BAD_TICKS", error.message);
        }

        // The claimed answer times must account for the wall clock this
        // attempt actually took — otherwise the speed bonus belongs to
        // whoever edits the payload, not whoever answers fastest.
        const rawSum = req.body.ticks.reduce((sum, tick) => sum + tick, 0);
        const elapsed = Date.now() - (play.startedAtMs || 0);
        if (
          rawSum > elapsed + TRICKS_LIMITS.elapsedGraceMs ||
          rawSum < elapsed - TRICKS_LIMITS.elapsedGraceMs
        ) {
          throw badRequest("TICKS_MISMATCH", "Your clock and ours disagree. Try again.");
        }

        const privateData = privateSnapshot.data();
        const correct = grade(trick.template, privateData.items, answers);
        const { total: score, perItem } = scoreTrick({ correct, ticks: clamped });

        const state = stateFor(stateSnapshot, day);
        const capRemaining = Math.max(0, config.tricksPointsCapPerDay - state.pointsAwardedToday);
        const gbpGain = isGuest ? 0 : Math.min(score, capRemaining);

        tx.update(playRef, {
          status: "scored",
          score,
          correct,
          ticks: clamped,
          submittedAtMs: Date.now(),
        });
        tx.set(
          statsRef,
          {
            trickId,
            playerId,
            plays: FieldValue.increment(1),
            lastScore: score,
            lastDay: day,
          },
          { merge: true },
        );
        tx.set(
          doc(cluster, "tricks", trickId),
          {
            playCount: FieldValue.increment(1),
            weeklyStats: { [week]: { plays: FieldValue.increment(1) } },
          },
          { merge: true },
        );

        const trickBoard = boardId("tricks", "game", trickId);
        creditBoard(tx, cluster, { board: trickBoard, player: playerId, points: score });
        const featured = featuredSnapshot.exists ? featuredSnapshot.data() : null;
        if (featured?.trickId === trickId) {
          creditBoard(tx, cluster, {
            board: boardId("tricks", "weekly", week),
            player: playerId,
            points: score,
          });
        }

        if (!isGuest) {
          // Boards carry the full score above; the ledger takes the capped
          // gain. Only ever the literal "tricks" here — the game string
          // becomes Firestore field names, and a trick id in that position
          // would grow user-controlled keys in every profile document.
          awardPoints(tx, cluster, { wallet: playerId, game: "tricks", points: gbpGain });
          if (score > 0) {
            publishFeed(tx, cluster, {
              wallet: playerId,
              game: "tricks",
              type: "trickPlay",
              text: `scored ${score} on "${trick.title}"`,
              points: gbpGain,
            });
          }
        }
        tx.set(
          stateRef,
          {
            playerId,
            day,
            submissions: state.submissions,
            pointsAwardedToday: state.pointsAwardedToday + gbpGain,
          },
          { merge: true },
        );

        return {
          score,
          perItem,
          correct,
          answers: revealAnswers(trick.template, privateData.items),
          pointsAwarded: gbpGain,
          capped: !isGuest && gbpGain < score,
          board: trickBoard,
        };
      });

      res.json(response);
    }),
  );

  app.post(
    "/tricks/:trickId/rate",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const trickId = requireTrickId(req.params.trickId);
      const playerId = req.session.wallet;
      const week = weekId(new Date());

      const originality = req.body?.originality;
      const fun = req.body?.fun;
      for (const value of [originality, fun]) {
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          throw badRequest("BAD_RATING", "Rate originality and fun from 1 to 5.");
        }
      }

      const ratingRef = doc(cluster, "trickRatings", `${trickId}__${playerId}`);
      const { response } = await runIdempotent(cluster, req.session.uid, requestId, async (tx) => {
        const [trickSnapshot, ratingSnapshot, statsSnapshot] = await Promise.all([
          tx.get(doc(cluster, "tricks", trickId)),
          tx.get(ratingRef),
          tx.get(doc(cluster, "trickPlayerStats", `${trickId}__${playerId}`)),
        ]);
        if (!trickSnapshot.exists) throw notFound("NO_TRICK", "No such trick.");
        const trick = trickSnapshot.data();
        if (trick.createdByPlayer === playerId) {
          throw forbidden("OWN_TRICK", "Rating your own trick is not a look.");
        }
        // You rate what you finished. The stats doc only exists after a
        // scored attempt, so its presence is the gate.
        if (!statsSnapshot.exists) {
          throw forbidden("NOT_PLAYED", "Play it first, then tell us what you thought.");
        }

        const previous = ratingSnapshot.exists ? ratingSnapshot.data() : null;
        tx.set(ratingRef, {
          trickId,
          playerId,
          originality,
          fun,
          updatedAt: FieldValue.serverTimestamp(),
          ...(previous ? {} : { createdAt: FieldValue.serverTimestamp() }),
        });
        // A re-rate replaces your opinion, never adds a second vote.
        tx.set(
          doc(cluster, "tricks", trickId),
          {
            ratingCount: FieldValue.increment(previous ? 0 : 1),
            originalitySum: FieldValue.increment(originality - (previous?.originality || 0)),
            funSum: FieldValue.increment(fun - (previous?.fun || 0)),
            ...(previous ? {} : { weeklyStats: { [week]: { raters: FieldValue.increment(1) } } }),
          },
          { merge: true },
        );

        return { rated: true, originality, fun, changed: Boolean(previous) };
      });

      res.json(response);
    }),
  );

  app.post(
    "/tricks/:trickId/report",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const trickId = requireTrickId(req.params.trickId);
      const playerId = req.session.wallet;
      const reason = capped(req.body?.reason, 280, "reason");
      const config = await readConfig(cluster);

      const reportRef = doc(cluster, "trickReports", `${trickId}__${playerId}`);
      const { response } = await runIdempotent(cluster, req.session.uid, requestId, async (tx) => {
        const [trickSnapshot, reportSnapshot, statsSnapshot] = await Promise.all([
          tx.get(doc(cluster, "tricks", trickId)),
          tx.get(reportRef),
          tx.get(doc(cluster, "trickPlayerStats", `${trickId}__${playerId}`)),
        ]);
        if (!trickSnapshot.exists) throw notFound("NO_TRICK", "No such trick.");
        if (!statsSnapshot.exists) {
          throw forbidden("NOT_PLAYED", "Play it first — then flag it if you must.");
        }
        if (reportSnapshot.exists) {
          // One flag per player; saying it twice is still one flag.
          return { reported: true, repeated: true };
        }

        const trick = trickSnapshot.data();
        const reportCount = (trick.reportCount || 0) + 1;
        tx.set(reportRef, {
          trickId,
          playerId,
          reason: reason || null,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          doc(cluster, "tricks", trickId),
          {
            reportCount: FieldValue.increment(1),
            // Enough distinct players can pull a trick off the shelf at 3am
            // without waiting for an admin; an admin confirms or reinstates.
            ...(trick.status === "approved" && reportCount >= config.tricksReportsToPause
              ? { status: "paused", pausedAt: FieldValue.serverTimestamp() }
              : {}),
          },
          { merge: true },
        );

        return { reported: true, repeated: false };
      });

      res.json(response);
    }),
  );
}

/** The status pipeline: what an admin may do to a trick, and from where. */
const ADMIN_TRANSITIONS = {
  approve: { from: ["pending"], to: "approved" },
  reject: { from: ["pending"], to: "rejected" },
  remove: { from: ["pending", "approved", "paused"], to: "removed" },
  reinstate: { from: ["paused", "removed"], to: "approved" },
};

export function mountTricksAdminRoutes(app, cluster) {
  app.get(
    "/admin/tricks/pending",
    handler(async (req, res) => {
      const pending = await col(cluster, "tricks")
        .where("status", "==", "pending")
        .orderBy("createdAtMs", "asc")
        .limit(50)
        .get();
      // Review needs the answers: a quiz is only judgeable with its key. The
      // admin session is the one reader the private half was built to allow.
      const withAnswers = await Promise.all(
        pending.docs.map(async (entry) => {
          const privateSnapshot = await doc(cluster, "tricksPrivate", entry.id).get();
          return {
            ...summarize(entry.data()),
            items: entry.data().items,
            answers: privateSnapshot.exists
              ? revealAnswers(entry.data().template, privateSnapshot.data().items)
              : null,
          };
        }),
      );
      res.json({ pending: withAnswers });
    }),
  );

  app.post(
    "/admin/tricks/feature/:weekId",
    handler(async (req, res) => {
      const week = req.params.weekId;
      if (!/^\d{4}-W\d{2}$/.test(week)) {
        throw badRequest("BAD_WEEK", "Weeks look like 2026-W35.");
      }
      const trickId = requireTrickId(req.body?.trickId);
      const config = await readConfig(cluster);

      const result = await db().runTransaction(async (tx) => {
        const [trickSnapshot, featuredSnapshot] = await Promise.all([
          tx.get(doc(cluster, "tricks", trickId)),
          tx.get(doc(cluster, "featuredTricks", week)),
        ]);
        if (!trickSnapshot.exists) throw notFound("NO_TRICK", "No such trick.");
        const trick = trickSnapshot.data();
        if (trick.status !== "approved") {
          throw conflict("NOT_APPROVED", "Only an approved trick can be featured.");
        }

        const featured = featuredSnapshot.exists ? featuredSnapshot.data() : null;
        const previousId = featured?.trickId || null;
        if (previousId === trickId) return { week, trickId, unchanged: true };

        const prizeCycle = featured?.prizeCycle || null;
        let cycleSnapshot = null;
        if (prizeCycle) {
          cycleSnapshot = await tx.get(doc(cluster, "prizeCycles", prizeCycle));
        }
        // A paid snapshot is a historical record with published receipts;
        // overriding the pick after the money moved is not an edit, it is a
        // new decision that has to be argued in the open.
        if (cycleSnapshot?.exists && cycleSnapshot.data().status === "paid") {
          throw conflict("CYCLE_PAID", "That week's snapshot is already paid.");
        }

        tx.set(
          doc(cluster, "featuredTricks", week),
          {
            week,
            trickId,
            prizeCycle,
            shortlist: featured?.shortlist || [],
            decidedBy: "admin",
            overriddenBy: req.session.wallet,
            decidedAt: FieldValue.serverTimestamp(),
          },
          { merge: false },
        );
        if (previousId) {
          tx.set(doc(cluster, "tricks", previousId), { featuredWeek: null }, { merge: true });
        }
        tx.set(doc(cluster, "tricks", trickId), { featuredWeek: week }, { merge: true });

        let rewroteCycle = false;
        if (cycleSnapshot?.exists) {
          const cycle = cycleSnapshot.data();
          const board = boardId("tricks", "weekly", prizeCycle);
          const others = (cycle.winners || []).filter((winner) => winner.game !== "tricks");
          const previousRow = (cycle.winners || []).find((winner) => winner.game === "tricks");
          const prizeBuddy =
            previousRow?.prizeBuddy ?? (config.prizeTable?.["tricks:weekly"] || [])[0] ?? 0;
          const winners = [
            ...others,
            {
              wallet: trick.payoutWallet,
              board,
              game: "tricks",
              position: 1,
              points: trickScoreX100(trick),
              prizeBuddy,
              trickId,
              createdByPlayer: trick.createdByPlayer,
            },
          ];
          tx.update(doc(cluster, "prizeCycles", prizeCycle), {
            winners,
            totalBuddy: winners.reduce((sum, winner) => sum + winner.prizeBuddy, 0),
            // The payout script refuses a snapshot whose hash does not match
            // its winners, so the hash moves with them or the cycle is
            // unpayable.
            artifactSha256: computeArtifactSha(cluster, prizeCycle, winners),
            overriddenBy: req.session.wallet,
            overriddenAt: FieldValue.serverTimestamp(),
          });
          rewroteCycle = true;
        }

        return { week, trickId, previousTrickId: previousId, prizeCycle, rewroteCycle };
      });

      res.json(result);
    }),
  );

  for (const [action, transition] of Object.entries(ADMIN_TRANSITIONS)) {
    app.post(
      `/admin/tricks/:trickId/${action}`,
      handler(async (req, res) => {
        const trickId = requireTrickId(req.params.trickId);
        const ref = doc(cluster, "tricks", trickId);
        const result = await db().runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) throw notFound("NO_TRICK", "No such trick.");
          const trick = snapshot.data();
          if (!transition.from.includes(trick.status)) {
            throw conflict(
              "BAD_TRANSITION",
              `Cannot ${action} a ${trick.status} trick.`,
            );
          }
          tx.update(ref, {
            status: transition.to,
            reviewedBy: req.session.wallet,
            reviewedAt: FieldValue.serverTimestamp(),
            ...(action === "approve" || action === "reinstate"
              ? { approvedAtMs: trick.approvedAtMs || Date.now(), reportCount: 0 }
              : {}),
          });
          if (action === "approve") {
            publishFeed(tx, cluster, {
              game: "tricks",
              type: "trickApproved",
              text: `a new trick hit the shelf: "${trick.title}"`,
            });
          }
          return { trickId, status: transition.to };
        });
        res.json(result);
      }),
    );
  }
}
