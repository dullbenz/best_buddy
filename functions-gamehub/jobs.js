/**
 * Scheduled work: rollovers, sealing boards, and cutting the weekly prize
 * snapshot.
 *
 * Every job is a plain exported function that the scheduler calls and that the
 * devnet-only test routes can also call directly. That is what makes the
 * time-based half of the hub testable end to end without waiting a week for a
 * Monday.
 *
 * Nothing here moves tokens. The weekly job's output is a snapshot document —
 * a list of wallets and amounts — that a human then pays from the Squads vault
 * and marks paid. An automated payout would need a hot wallet holding the
 * community's prize pool, and that is not a trade this project makes.
 */
import { createHash } from "node:crypto";

import {
  boardId,
  col,
  dayId,
  doc,
  db,
  FieldValue,
  nextWeekBoundary,
  readConfig,
  weekId,
} from "./db.js";
import { aggregatePets } from "./games/pet.js";
import { expireStaleChallenges } from "./games/tournament.js";
import { runHuntLifecycle } from "./games/hunt.js";
import { accrueStakingPoints } from "./games/reputation.js";

/** How many entries of a sealed board are frozen into its meta document. */
const SEAL_DEPTH = 100;

/**
 * Freeze a board's standings.
 *
 * Once sealed, the snapshot in the meta document is the record — later writes
 * to the entries (a late submission, a correction) cannot change what a cycle
 * paid out on.
 */
export async function sealBoard(cluster, board, { endsAtIso } = {}) {
  const entries = await col(cluster, "leaderboards")
    .doc(board)
    .collection("entries")
    .orderBy("points", "desc")
    .limit(SEAL_DEPTH)
    .get();

  const sealedTop = entries.docs.map((snapshot, index) => ({
    position: index + 1,
    wallet: snapshot.data().wallet,
    points: snapshot.data().points || 0,
  }));

  await doc(cluster, "leaderboardMeta", board).set(
    {
      board,
      status: "final",
      sealedTop,
      endsAtIso: endsAtIso || null,
      sealedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return sealedTop;
}

export async function openBoard(cluster, board, { endsAtIso } = {}) {
  await doc(cluster, "leaderboardMeta", board).set(
    {
      board,
      status: "open",
      endsAtIso: endsAtIso || null,
      openedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * The daily turn of the crank.
 *
 * `at` is injectable so the devnet test route can roll a day forward without
 * anyone having to wait for midnight.
 */
export async function runDailyRollover(cluster, at = new Date()) {
  const today = dayId(at);
  const yesterday = dayId(new Date(at.getTime() - 86400000));

  const sealed = [];
  for (const game of ["pet", "fetch", "runner"]) {
    sealed.push({
      board: boardId(game, "daily", yesterday),
      top: await sealBoard(cluster, boardId(game, "daily", yesterday)),
    });
    await openBoard(cluster, boardId(game, "daily", today));
  }

  const expiredChallenges = await expireStaleChallenges(cluster);
  const abandonedRuns = await expireStaleRuns(cluster);

  return { day: today, sealed: sealed.length, expiredChallenges, abandonedRuns };
}

/** Runs left open — the browser closed mid-game — are not scored. */
export async function expireStaleRuns(cluster) {
  const cutoff = Date.now() - 20 * 60 * 1000;
  const stale = await col(cluster, "runnerRuns")
    .where("status", "==", "open")
    .where("startedAtMs", "<", cutoff)
    .limit(200)
    .get();

  if (stale.empty) return 0;
  const batch = db().batch();
  for (const snapshot of stale.docs) batch.update(snapshot.ref, { status: "abandoned" });
  await batch.commit();
  return stale.size;
}

/**
 * Close the week and cut the prize snapshot.
 *
 * The snapshot is deliberately a plain, hashable object: it gets committed to
 * the repo alongside the payout receipts, so anyone can check that the wallets
 * that were paid are the wallets that won.
 */
export async function runWeeklyRollover(cluster, at = new Date()) {
  const config = await readConfig(cluster);
  const closingWeek = weekId(new Date(at.getTime() - 86400000));
  const openingWeek = weekId(at);
  const nextBoundary = nextWeekBoundary(at).toISOString();

  const winners = [];
  const boards = [];

  for (const game of ["fetch", "pet", "runner"]) {
    const board = boardId(game, "weekly", closingWeek);
    const sealedTop = await sealBoard(cluster, board);
    boards.push(board);

    const prizes = config.prizeTable?.[`${game}:weekly`] || [];
    sealedTop.slice(0, prizes.length).forEach((entry, index) => {
      if (!entry.points) return;
      winners.push({
        wallet: entry.wallet,
        board,
        game,
        position: entry.position,
        points: entry.points,
        prizeBuddy: prizes[index],
      });
    });

    await openBoard(cluster, boardId(game, "weekly", openingWeek), { endsAtIso: nextBoundary });
  }

  const artifact = {
    cluster,
    cycle: closingWeek,
    generatedAtIso: new Date().toISOString(),
    boards,
    winners,
    totalBuddy: winners.reduce((sum, winner) => sum + winner.prizeBuddy, 0),
  };
  // Hash the winners, not the wrapper: the generation timestamp changing must
  // not change the identity of the payout list.
  const artifactSha256 = createHash("sha256")
    .update(JSON.stringify({ cluster, cycle: closingWeek, winners }))
    .digest("hex");

  await doc(cluster, "prizeCycles", closingWeek).set(
    {
      ...artifact,
      artifactSha256,
      status: "snapshotted",
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (winners.length) {
    await col(cluster, "feed").add({
      type: "cycleClosed",
      game: null,
      wallet: null,
      text: `${closingWeek} is settled — ${winners.length} winners, ${artifact.totalBuddy.toLocaleString("en-US")} $BUDDY to pay`,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    });
  }

  return { cycle: closingWeek, winners: winners.length, artifactSha256 };
}

export async function runPetAggregate(cluster) {
  return aggregatePets(cluster);
}

export async function runStakeSnapshot(cluster) {
  return accrueStakingPoints(cluster);
}

export async function runHuntTick(cluster) {
  return runHuntLifecycle(cluster);
}
