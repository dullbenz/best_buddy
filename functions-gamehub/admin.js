/**
 * Operator endpoints: authoring hunts, tuning config, and running the prize
 * cycle.
 *
 * Admin is an allowlist of wallets checked on every request, not a role stored
 * anywhere mutable. Hunt answers arrive here in plaintext and are salted and
 * hashed before storage — this is the only moment the server ever sees them.
 */
import { col, doc, FieldValue, readConfig, DEFAULT_CONFIG, root } from "./db.js";
import { badRequest, conflict, handler, notFound } from "./middleware.js";
import { hashSecret, newSalt } from "./games/hunt.js";
import { runDailyRollover, runWeeklyRollover } from "./jobs.js";

/**
 * Turn an authored hunt into its public half and its secret half.
 *
 * The split is the whole security model: `hunts/{id}` is world-readable and
 * carries clues, `huntsPrivate/{id}` is unreadable by any client and carries
 * only hashes.
 */
export function prepareHunt(input) {
  const huntId = String(input.huntId || "").trim();
  if (!/^[a-z0-9-]{3,40}$/.test(huntId)) {
    throw badRequest("BAD_HUNT_ID", "Hunt id must be lowercase letters, numbers and dashes.");
  }
  if (!Array.isArray(input.bones) || input.bones.length === 0) {
    throw badRequest("NO_BONES", "A hunt needs at least one bone.");
  }

  const startAtMs = Date.parse(input.startAtIso);
  const endAtMs = Date.parse(input.endAtIso);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs) {
    throw badRequest("BAD_WINDOW", "A hunt needs a start and a later end.");
  }

  const publicBones = [];
  const privateBones = [];
  for (const bone of input.bones) {
    const boneId = String(bone.boneId || "").trim();
    if (!/^[a-z0-9-]{2,40}$/.test(boneId)) {
      throw badRequest("BAD_BONE_ID", `Bone id "${boneId}" is not usable.`);
    }
    if (!bone.code) throw badRequest("NO_CODE", `Bone "${boneId}" has no code.`);
    const salt = newSalt();
    publicBones.push({
      boneId,
      clue: String(bone.clue || ""),
      where: String(bone.where || ""),
      maxClaims: Math.max(1, Number(bone.maxClaims) || 25),
      claimsSoFar: 0,
    });
    privateBones.push({
      boneId,
      name: String(bone.name || boneId),
      salt,
      codeHash: hashSecret(salt, bone.code),
    });
  }

  const publicPuzzles = [];
  const privatePuzzles = [];
  for (const puzzle of input.puzzles || []) {
    const puzzleId = String(puzzle.puzzleId || "").trim();
    if (!/^[a-z0-9-]{2,40}$/.test(puzzleId)) {
      throw badRequest("BAD_PUZZLE_ID", `Puzzle id "${puzzleId}" is not usable.`);
    }
    if (!puzzle.answer) throw badRequest("NO_ANSWER", `Puzzle "${puzzleId}" has no answer.`);
    const salt = newSalt();
    publicPuzzles.push({ puzzleId, prompt: String(puzzle.prompt || "") });
    privatePuzzles.push({
      puzzleId,
      salt,
      answerHash: hashSecret(salt, puzzle.answer),
      unlocksClue: puzzle.unlocksClue ? String(puzzle.unlocksClue) : null,
      revealsBoneCode: puzzle.revealsBoneCode ? String(puzzle.revealsBoneCode) : null,
    });
  }

  return {
    publicDoc: {
      huntId,
      title: String(input.title || huntId),
      intro: String(input.intro || ""),
      state: "scheduled",
      startAtMs,
      endAtMs,
      startAtIso: new Date(startAtMs).toISOString(),
      endAtIso: new Date(endAtMs).toISOString(),
      bones: publicBones,
      puzzles: publicPuzzles,
    },
    privateDoc: { huntId, bones: privateBones, puzzles: privatePuzzles },
  };
}

export function mountAdminRoutes(app, cluster) {
  app.post(
    "/admin/hunt",
    handler(async (req, res) => {
      const { publicDoc, privateDoc } = prepareHunt(req.body || {});
      const existing = await doc(cluster, "hunts", publicDoc.huntId).get();
      if (existing.exists && req.body?.overwrite !== true) {
        throw conflict("HUNT_EXISTS", "That hunt id is taken. Pass overwrite to replace it.");
      }

      await Promise.all([
        doc(cluster, "hunts", publicDoc.huntId).set({
          ...publicDoc,
          authoredBy: req.session.wallet,
          createdAt: FieldValue.serverTimestamp(),
        }),
        doc(cluster, "huntsPrivate", publicDoc.huntId).set({
          ...privateDoc,
          authoredBy: req.session.wallet,
          createdAt: FieldValue.serverTimestamp(),
        }),
      ]);

      res.json({
        huntId: publicDoc.huntId,
        state: publicDoc.state,
        bones: publicDoc.bones.length,
        puzzles: publicDoc.puzzles.length,
      });
    }),
  );

  for (const [path, state] of [
    ["/admin/hunt/:huntId/activate", "active"],
    ["/admin/hunt/:huntId/end", "ended"],
  ]) {
    app.post(
      path,
      handler(async (req, res) => {
        const ref = doc(cluster, "hunts", req.params.huntId);
        if (!(await ref.get()).exists) throw notFound("NO_HUNT", "No such hunt.");
        await ref.update({ state });
        res.json({ huntId: req.params.huntId, state });
      }),
    );
  }

  app.get(
    "/admin/config",
    handler(async (req, res) => {
      res.json({ config: await readConfig(cluster), defaults: DEFAULT_CONFIG });
    }),
  );

  app.post(
    "/admin/config",
    handler(async (req, res) => {
      const patch = req.body?.config;
      if (!patch || typeof patch !== "object") throw badRequest("BAD_CONFIG", "Send a config object.");
      // Unknown keys are rejected rather than stored: a typo should not
      // silently become a setting nothing reads.
      const unknown = Object.keys(patch).filter((key) => !(key in DEFAULT_CONFIG));
      if (unknown.length) {
        throw badRequest("UNKNOWN_CONFIG", `Not a setting: ${unknown.join(", ")}`);
      }
      await root(cluster).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      res.json({ config: await readConfig(cluster) });
    }),
  );

  app.get(
    "/admin/prize-cycle/:cycleId",
    handler(async (req, res) => {
      const snapshot = await doc(cluster, "prizeCycles", req.params.cycleId).get();
      if (!snapshot.exists) throw notFound("NO_CYCLE", "No such prize cycle.");
      const data = snapshot.data();
      // Exactly the shape scripts/gamehub-payout.ts expects to be handed.
      res.json({
        cluster: data.cluster,
        cycle: data.cycle,
        generatedAtIso: data.generatedAtIso,
        boards: data.boards,
        winners: data.winners,
        totalBuddy: data.totalBuddy,
        artifactSha256: data.artifactSha256,
        status: data.status,
      });
    }),
  );

  app.get(
    "/admin/prize-cycle",
    handler(async (req, res) => {
      const snapshot = await col(cluster, "prizeCycles").orderBy("cycle", "desc").limit(25).get();
      res.json({
        cycles: snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            cycle: data.cycle,
            status: data.status,
            winners: data.winners?.length || 0,
            totalBuddy: data.totalBuddy,
          };
        }),
      });
    }),
  );

  app.post(
    "/admin/prize-cycle/:cycleId/mark-paid",
    handler(async (req, res) => {
      const { cycleId } = req.params;
      const txSignatures = req.body?.txSignatures;
      const receiptUrl = req.body?.receiptUrl;
      if (!Array.isArray(txSignatures) || txSignatures.length === 0) {
        throw badRequest("NO_SIGNATURES", "A payout is not paid without its transactions.");
      }

      const ref = doc(cluster, "prizeCycles", cycleId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw notFound("NO_CYCLE", "No such prize cycle.");
      const cycle = snapshot.data();

      await ref.update({
        status: "paid",
        txSignatures,
        receiptUrl: receiptUrl || null,
        paidAt: FieldValue.serverTimestamp(),
        paidBy: req.session.wallet,
      });

      // The public receipt. Every prize row in the hub links to the transaction
      // that paid it, which is the only claim worth making about a payout.
      await doc(cluster, "payouts", cycleId).set({
        cycle: cycleId,
        winners: cycle.winners || [],
        totalBuddy: cycle.totalBuddy || 0,
        txSignatures,
        receiptUrl: receiptUrl || null,
        artifactSha256: cycle.artifactSha256,
        publishedAt: FieldValue.serverTimestamp(),
      });

      res.json({ cycle: cycleId, status: "paid", txSignatures });
    }),
  );

  /** Manual triggers, for when a scheduled job needs re-running. */
  app.post(
    "/admin/run-job/:job",
    handler(async (req, res) => {
      const jobs = { daily: runDailyRollover, weekly: runWeeklyRollover };
      const job = jobs[req.params.job];
      if (!job) throw notFound("NO_JOB", "No such job.");
      res.json({ job: req.params.job, result: await job(cluster) });
    }),
  );
}
