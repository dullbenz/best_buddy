/**
 * Bone Hunt.
 *
 * Bones are hidden around the hub — some as quiet interactive elements on the
 * pages, some behind riddles that lean on the project's own lore. Finding one
 * means bringing back its code. Each bone has a limited number of claims, so
 * being early matters.
 *
 * Answers and bone codes are stored only as salted hashes, in a collection no
 * client can read. That way the puzzle survives someone reading the bundle,
 * inspecting network traffic, or getting a look at the database.
 *
 * Digging costs a shovel, and shovels refill daily. Stakers get a couple more.
 */
import { createHash, randomBytes } from "node:crypto";

import { col, dayId, doc, db, FieldValue, readConfig } from "../db.js";
import { awardPoints } from "../points.js";
import {
  badRequest,
  conflict,
  handler,
  notFound,
  requireRequestId,
  runIdempotent,
  tooMany,
} from "../middleware.js";
import { getStakeStatus } from "../stake.js";

/** Points for being the Nth finder of a bone: early finders get more. */
const FINDER_POINTS = [500, 400, 320, 260, 210, 170, 140, 120, 100];
const LATE_FINDER_POINTS = 80;

const ANSWER_ATTEMPTS_PER_HOUR = 8;

/** Normalized so "Block 299825" and "block299825" are the same answer. */
export function normalizeAnswer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function hashSecret(salt, value) {
  return createHash("sha256").update(`${salt}:${normalizeAnswer(value)}`).digest("hex");
}

export function newSalt() {
  return randomBytes(16).toString("hex");
}

async function shovelState(cluster, wallet, config) {
  const [playerSnapshot, stake] = await Promise.all([
    doc(cluster, "players", wallet).get(),
    getStakeStatus(cluster, wallet),
  ]);
  const day = dayId(new Date());
  const hunt = playerSnapshot.exists ? playerSnapshot.data()?.hunt || {} : {};
  const used = hunt.day === day ? hunt.shovelsUsed || 0 : 0;
  const allowance =
    config.huntShovelsPerDay + (stake.staked ? config.huntShovelsStakedBonus : 0);
  return { day, used, allowance, remaining: Math.max(0, allowance - used), staked: stake.staked };
}

async function activeHunt(cluster) {
  const snapshot = await col(cluster, "hunts")
    .where("state", "==", "active")
    .orderBy("startAtMs", "desc")
    .limit(1)
    .get();
  return snapshot.empty ? null : snapshot.docs[0].data();
}

/**
 * The hunt anyone can look at.
 *
 * Clues and claim counts are public — half the pull of a hunt is watching the
 * bones run out. Only digging needs a wallet, and the shovel count only appears
 * once there is one to count for.
 */
export function mountHuntPublicRoutes(app, cluster) {
  app.get(
    "/hunt/current",
    handler(async (req, res) => {
      const config = await readConfig(cluster);
      const hunt = await activeHunt(cluster);
      if (!hunt) {
        const upcoming = await col(cluster, "hunts")
          .where("state", "==", "scheduled")
          .orderBy("startAtMs", "asc")
          .limit(1)
          .get();
        res.json({
          hunt: null,
          nextHuntAt: upcoming.empty ? null : upcoming.docs[0].data().startAtIso,
        });
        return;
      }

      const wallet = req.session?.wallet || null;
      const [shovels, found] = await Promise.all([
        wallet ? shovelState(cluster, wallet, config) : null,
        wallet
          ? col(cluster, "huntClaims").where("huntId", "==", hunt.huntId).where("wallet", "==", wallet).get()
          : null,
      ]);

      res.json({
        hunt: {
          huntId: hunt.huntId,
          title: hunt.title,
          intro: hunt.intro,
          state: hunt.state,
          startAtIso: hunt.startAtIso,
          endAtIso: hunt.endAtIso,
          // Clue text is public; what the clue is hiding is not.
          bones: (hunt.bones || []).map((bone) => ({
            boneId: bone.boneId,
            clue: bone.clue,
            where: bone.where,
            maxClaims: bone.maxClaims,
            claimsSoFar: bone.claimsSoFar || 0,
            remaining: Math.max(0, bone.maxClaims - (bone.claimsSoFar || 0)),
          })),
          puzzles: (hunt.puzzles || []).map((puzzle) => ({
            puzzleId: puzzle.puzzleId,
            prompt: puzzle.prompt,
          })),
        },
        shovels,
        found: found ? found.docs.map((snapshot) => snapshot.data().boneId) : [],
      });
    }),
  );
}

export function mountHuntRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/hunt/:huntId/answer",
    rateLimits.huntAnswer,
    handler(async (req, res) => {
      const { huntId } = req.params;
      const puzzleId = req.body?.puzzleId;
      const answer = req.body?.answer;
      if (typeof puzzleId !== "string" || typeof answer !== "string") {
        throw badRequest("BAD_ANSWER", "Send a puzzle and an answer.");
      }

      const [publicSnapshot, privateSnapshot] = await Promise.all([
        doc(cluster, "hunts", huntId).get(),
        doc(cluster, "huntsPrivate", huntId).get(),
      ]);
      if (!publicSnapshot.exists || !privateSnapshot.exists) {
        throw notFound("NO_HUNT", "No such hunt.");
      }
      if (publicSnapshot.data().state !== "active") {
        throw conflict("HUNT_CLOSED", "That hunt is not running.");
      }

      const secret = (privateSnapshot.data().puzzles || []).find(
        (puzzle) => puzzle.puzzleId === puzzleId,
      );
      if (!secret) throw notFound("NO_PUZZLE", "No such puzzle.");

      const correct = hashSecret(secret.salt, answer) === secret.answerHash;
      res.json({
        correct,
        // The reward for solving a puzzle is the clue it was guarding.
        clue: correct ? secret.unlocksClue || null : null,
        boneCode: correct ? secret.revealsBoneCode || null : null,
      });
    }),
  );

  app.post(
    "/hunt/:huntId/dig",
    rateLimits.game,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      const { huntId } = req.params;
      const boneCode = req.body?.boneCode;
      if (typeof boneCode !== "string" || !boneCode.trim()) {
        throw badRequest("BAD_CODE", "What did you dig up?");
      }

      const wallet = req.session.wallet;
      const uid = req.session.uid;
      const config = await readConfig(cluster);
      const shovels = await shovelState(cluster, wallet, config);
      if (shovels.remaining <= 0) {
        throw tooMany("NO_SHOVELS", "You're out of shovels for today.", {
          allowance: shovels.allowance,
          staked: shovels.staked,
        });
      }

      const privateSnapshot = await doc(cluster, "huntsPrivate", huntId).get();
      if (!privateSnapshot.exists) throw notFound("NO_HUNT", "No such hunt.");
      const match = (privateSnapshot.data().bones || []).find(
        (bone) => hashSecret(bone.salt, boneCode) === bone.codeHash,
      );

      const huntRef = doc(cluster, "hunts", huntId);
      const playerRef = doc(cluster, "players", wallet);

      const claimRef = match
        ? doc(cluster, "huntClaims", `${huntId}__${match.boneId}__${wallet}`)
        : null;

      const { response } = await runIdempotent(cluster, uid, requestId, async (tx) => {
        // Firestore requires every read in a transaction to happen before every
        // write, so the claim lookup has to be gathered up front with the rest.
        const [huntSnapshot, playerSnapshot, existingClaim] = await Promise.all([
          tx.get(huntRef),
          tx.get(playerRef),
          claimRef ? tx.get(claimRef) : Promise.resolve(null),
        ]);
        if (!huntSnapshot.exists) throw notFound("NO_HUNT", "No such hunt.");
        const hunt = huntSnapshot.data();
        if (hunt.state !== "active") throw conflict("HUNT_CLOSED", "That hunt is not running.");

        const huntState = playerSnapshot.exists ? playerSnapshot.data()?.hunt || {} : {};
        const usedToday = huntState.day === shovels.day ? huntState.shovelsUsed || 0 : 0;
        if (usedToday >= shovels.allowance) {
          throw tooMany("NO_SHOVELS", "You're out of shovels for today.");
        }
        if (existingClaim?.exists) {
          throw conflict("ALREADY_FOUND", "You already dug up that one.");
        }

        // A dig costs a shovel whether or not it turns anything up. That is
        // what makes a wrong guess cost something and a clue worth solving.
        tx.set(
          playerRef,
          { wallet, hunt: { day: shovels.day, shovelsUsed: usedToday + 1 } },
          { merge: true },
        );

        if (!match) {
          return {
            found: false,
            shovelsRemaining: shovels.allowance - (usedToday + 1),
            message: "Nothing but dirt here.",
          };
        }

        const bones = hunt.bones || [];
        const index = bones.findIndex((bone) => bone.boneId === match.boneId);
        if (index === -1) throw notFound("NO_BONE", "That bone is not part of this hunt.");
        const claimsSoFar = bones[index].claimsSoFar || 0;
        if (claimsSoFar >= bones[index].maxClaims) {
          throw conflict("BONE_GONE", "Someone beat you to the last one.");
        }

        const finderRank = claimsSoFar + 1;
        const points = FINDER_POINTS[finderRank - 1] ?? LATE_FINDER_POINTS;

        const updatedBones = bones.map((bone, position) =>
          position === index ? { ...bone, claimsSoFar: claimsSoFar + 1 } : bone,
        );
        tx.update(huntRef, { bones: updatedBones });

        tx.set(claimRef, {
          huntId,
          boneId: match.boneId,
          wallet,
          finderRank,
          points,
          claimedAt: FieldValue.serverTimestamp(),
        });

        awardPoints(tx, cluster, {
          wallet,
          game: "hunt",
          points,
          feed: {
            type: "boneClaim",
            text: `dug up ${match.boneId} (finder #${finderRank})`,
            points,
          },
        });

        return {
          found: true,
          boneId: match.boneId,
          name: match.name || match.boneId,
          finderRank,
          points,
          remaining: bones[index].maxClaims - finderRank,
          shovelsRemaining: shovels.allowance - (usedToday + 1),
        };
      });

      res.json(response);
    }),
  );

  app.get(
    "/hunt/inventory",
    handler(async (req, res) => {
      const claims = await col(cluster, "huntClaims")
        .where("wallet", "==", req.session.wallet)
        .limit(200)
        .get();
      res.json({
        bones: claims.docs.map((snapshot) => {
          const data = snapshot.data();
          return {
            huntId: data.huntId,
            boneId: data.boneId,
            finderRank: data.finderRank,
            points: data.points,
            claimedAtMs: data.claimedAt?.toMillis?.() || null,
          };
        }),
      });
    }),
  );
}

/** Open hunts whose start time has arrived and close ones that are over. */
export async function runHuntLifecycle(cluster) {
  const now = Date.now();
  const [toOpen, toClose] = await Promise.all([
    col(cluster, "hunts").where("state", "==", "scheduled").where("startAtMs", "<=", now).get(),
    col(cluster, "hunts").where("state", "==", "active").where("endAtMs", "<=", now).get(),
  ]);

  const batch = db().batch();
  for (const snapshot of toOpen.docs) batch.update(snapshot.ref, { state: "active" });
  for (const snapshot of toClose.docs) batch.update(snapshot.ref, { state: "ended" });
  if (toOpen.size || toClose.size) await batch.commit();

  for (const snapshot of toOpen.docs) {
    await col(cluster, "feed").add({
      type: "huntOpened",
      game: "hunt",
      wallet: null,
      text: `${snapshot.data().title} has begun — the bones are buried`,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
  }

  return { opened: toOpen.size, closed: toClose.size };
}
