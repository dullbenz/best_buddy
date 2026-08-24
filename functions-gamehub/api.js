/**
 * The game hub API.
 *
 * `makeApi(cluster)` returns an Express app bound to one chain. The cluster is
 * supplied by the export in index.js and is never read from the request, so the
 * devnet deployment cannot be talked into writing mainnet data no matter what
 * a caller sends.
 *
 * Routes live under /api/* by way of a Hosting rewrite; the function itself
 * sees the full path, so the router is mounted at /api as well as at the root
 * to keep local emulator calls and deployed calls identical.
 */
import express from "express";
import { getApps, initializeApp } from "firebase-admin/app";

import { assertCluster, col, doc, dayId, weekId, boardId, readConfig } from "./db.js";
import { errorHandler, handler, rateLimit } from "./middleware.js";
import { mountAuthRoutes, requireAdmin, requireSession } from "./auth.js";
import { mountPetRoutes } from "./games/pet.js";
import { mountFetchRoutes } from "./games/fetch.js";
import { mountRunnerRoutes } from "./games/runner.js";
import { mountTournamentRoutes } from "./games/tournament.js";
import { mountHuntRoutes, mountHuntPublicRoutes } from "./games/hunt.js";
import { mountReputationRoutes, profileFor } from "./games/reputation.js";
import { mountAdminRoutes } from "./admin.js";
import { getStakeStatus } from "./stake.js";
import { runDailyRollover, runWeeklyRollover } from "./jobs.js";

function ensureAdminApp() {
  if (getApps().length === 0) initializeApp();
}

/**
 * Routes that exist only on devnet.
 *
 * Time is the hard thing to test in a game built on daily streaks and weekly
 * cycles. These let the end-to-end suite roll a day or a week forward on
 * demand. They are mounted inside a cluster check, so they are absent from the
 * production function rather than merely guarded within it — the strongest
 * version of "not in production" available.
 */
function mountTestRoutes(router, cluster) {
  const key = process.env.GAMEHUB_TEST_KEY;

  router.use("/test", (req, res, next) => {
    if (!key) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
      return;
    }
    if (req.get("x-test-key") !== key) {
      res.status(403).json({ error: { code: "BAD_TEST_KEY", message: "No." } });
      return;
    }
    next();
  });

  router.post(
    "/test/force-daily-rollover",
    handler(async (req, res) => {
      const at = req.body?.at ? new Date(req.body.at) : new Date();
      res.json(await runDailyRollover(cluster, at));
    }),
  );

  router.post(
    "/test/force-weekly-rollover",
    handler(async (req, res) => {
      const at = req.body?.at ? new Date(req.body.at) : new Date();
      res.json(await runWeeklyRollover(cluster, at));
    }),
  );

  /** Wipe one wallet's state so a suite can re-run from a clean slate. */
  router.post(
    "/test/reset-wallet/:wallet",
    handler(async (req, res) => {
      const { wallet } = req.params;
      await Promise.all([
        doc(cluster, "players", wallet).delete(),
        doc(cluster, "profiles", wallet).delete(),
        doc(cluster, "petState", wallet).delete(),
        doc(cluster, "stakeCache", wallet).delete(),
      ]);
      res.json({ reset: wallet });
    }),
  );
}

export function makeApi(cluster) {
  assertCluster(cluster);
  ensureAdminApp();

  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

  const rateLimits = {
    // Sign-in limits are per IP, and one IP is often a whole office, a campus,
    // or a mobile carrier's NAT. Set to stop scripted abuse, not to ration
    // legitimate sign-ins: issuing a nonce is a single small write, and the
    // endpoints that actually award anything are limited per wallet below.
    challenge: rateLimit(cluster, { scope: "challenge", limit: 200, windowMs: 60000, by: "ip" }),
    verify: rateLimit(cluster, { scope: "verify", limit: 200, windowMs: 60000, by: "ip" }),
    game: rateLimit(cluster, { scope: "game", limit: 60, windowMs: 60000, by: "wallet" }),
    pet: rateLimit(cluster, { scope: "pet", limit: 40, windowMs: 60000, by: "wallet" }),
    huntAnswer: rateLimit(cluster, { scope: "huntAnswer", limit: 8, windowMs: 3600000, by: "wallet" }),
  };

  router.get(
    "/healthz",
    handler(async (req, res) => {
      res.json({
        ok: true,
        cluster,
        commit: process.env.COMMIT_SHA || "unknown",
        time: new Date().toISOString(),
      });
    }),
  );

  /** Public: everything the hub home needs before anyone signs in. */
  router.get(
    "/summary",
    handler(async (req, res) => {
      const now = new Date();
      const config = await readConfig(cluster);
      const [shards, counter, feed] = await Promise.all([
        col(cluster, "petShards").get(),
        doc(cluster, "counters", "globalPets").get(),
        col(cluster, "feed").orderBy("createdAtMs", "desc").limit(10).get(),
      ]);
      const totalPets = shards.docs.reduce((sum, shard) => sum + (shard.data().count || 0), 0);

      res.json({
        cluster,
        totalPets,
        nextMilestone: config.milestones.find((milestone) => milestone > totalPets) || null,
        lastMilestone: counter.exists ? counter.data().lastMilestone || 0 : 0,
        currentWeek: weekId(now),
        currentDay: dayId(now),
        boards: {
          fetchWeekly: boardId("fetch", "weekly", weekId(now)),
          petDaily: boardId("pet", "daily", dayId(now)),
          runnerWeekly: boardId("runner", "weekly", weekId(now)),
        },
        feed: feed.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            type: data.type,
            wallet: data.wallet,
            text: data.text,
            points: data.points,
            createdAtMs: data.createdAtMs,
          };
        }),
      });
    }),
  );

  /** Public payout receipts. */
  router.get(
    "/prizes",
    handler(async (req, res) => {
      const [paid, current] = await Promise.all([
        col(cluster, "payouts").orderBy("cycle", "desc").limit(20).get(),
        col(cluster, "prizeCycles").where("status", "==", "snapshotted").orderBy("cycle", "desc").limit(5).get(),
      ]);
      const config = await readConfig(cluster);
      res.json({
        prizeTable: config.prizeTable,
        awaitingPayment: current.docs.map((entry) => {
          const data = entry.data();
          return { cycle: data.cycle, winners: data.winners?.length || 0, totalBuddy: data.totalBuddy };
        }),
        paid: paid.docs.map((entry) => {
          const data = entry.data();
          return {
            cycle: data.cycle,
            winners: data.winners || [],
            totalBuddy: data.totalBuddy || 0,
            txSignatures: data.txSignatures || [],
            receiptUrl: data.receiptUrl || null,
          };
        }),
      });
    }),
  );

  // Rate limits must be registered before the routes they protect: Express runs
  // middleware in registration order, so a limiter added afterwards never runs.
  router.use("/auth/challenge", rateLimits.challenge);
  router.use("/auth/verify", rateLimits.verify);
  mountAuthRoutes(router, cluster);

  /**
   * Attach a session if one was offered, but never demand one.
   *
   * Ranks, leaderboards and the current hunt are public — a visitor can look
   * around before connecting anything. A bad token here is treated as no token
   * rather than an error, because these endpoints work fine without one.
   */
  const attachSession = (req, res, next) => {
    if (!req.get("authorization")) {
      next();
      return;
    }
    requireSession(cluster)(req, res, () => next());
  };

  router.use(attachSession);
  mountReputationRoutes(router, cluster);
  mountHuntPublicRoutes(router, cluster);

  // Everything past here needs a signed-in wallet.
  const guarded = express.Router();
  guarded.use(requireSession(cluster));

  guarded.get(
    "/me",
    handler(async (req, res) => {
      const wallet = req.session.wallet;
      const [profile, stake, config] = await Promise.all([
        profileFor(cluster, wallet),
        getStakeStatus(cluster, wallet),
        readConfig(cluster),
      ]);
      res.json({
        wallet,
        cluster,
        admin: req.session.admin,
        profile,
        stake: {
          staked: stake.staked,
          totalAmount: stake.totalAmount,
          lockupCount: stake.lockupCount,
          source: stake.source,
        },
        perks: {
          goldenBone: stake.staked,
          superPet: stake.staked,
          extraShovels: stake.staked ? config.huntShovelsStakedBonus : 0,
        },
      });
    }),
  );

  mountPetRoutes(guarded, cluster, { rateLimits });
  mountFetchRoutes(guarded, cluster, { rateLimits });
  mountRunnerRoutes(guarded, cluster, { rateLimits });
  mountTournamentRoutes(guarded, cluster, { rateLimits });
  mountHuntRoutes(guarded, cluster, { rateLimits });

  const adminRouter = express.Router();
  adminRouter.use(requireSession(cluster), requireAdmin());
  mountAdminRoutes(adminRouter, cluster);

  // Test routes carry their own key check and must be reachable without a
  // wallet session, so they are mounted ahead of the session gate.
  if (cluster === "devnet") mountTestRoutes(router, cluster);

  router.use(guarded);
  router.use(adminRouter);

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    // The hub is not a public API surface to embed; it is same-origin only.
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", router);
  app.use(router);
  app.use(errorHandler(console));

  return app;
}
