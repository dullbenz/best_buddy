/**
 * The points ledger: the one place any game awards anything.
 *
 * Every game funnels through `awardPoints` so that a player's Good Boy Points,
 * their rank, the boards they appear on, and the activity feed can never drift
 * apart — they are written in the same transaction as the play that earned
 * them.
 *
 * Points are off-chain by design. The distributor program is immutable and has
 * no instruction that pays an arbitrary wallet, so there is no version of this
 * that settles on chain. Prizes are paid on a cycle by humans from the Squads
 * vault, against a snapshot of these numbers, with published receipts.
 */
import { col, doc, FieldValue, RANKS, rankFor } from "./db.js";

/** Feed entries are ephemeral colour, swept by a TTL policy. */
const FEED_TTL_MS = 24 * 3600 * 1000;

/**
 * @param {FirebaseFirestore.Transaction} tx
 * @param {string} cluster
 * @param {object} award
 * @param {string} award.wallet
 * @param {string} award.game          "fetch" | "pet" | "runner" | "hunt" | "tournament"
 * @param {number} award.points        may be 0 (a miss still records participation)
 * @param {string[]} [award.boards]    board ids this play counts toward
 * @param {object} [award.profile]     extra profile fields to merge
 * @param {object} [award.feed]        {text, type} to publish to the activity feed
 * @param {object} [award.totals]      extra `players.totals` increments
 */
export function awardPoints(tx, cluster, award) {
  const { wallet, game, points = 0, boards = [], profile = {}, feed = null, totals = {} } = award;
  const gained = Math.max(0, Math.trunc(points));

  const playerRef = doc(cluster, "players", wallet);
  tx.set(
    playerRef,
    {
      wallet,
      lastSeenAt: FieldValue.serverTimestamp(),
      totals: {
        [`${game}Points`]: FieldValue.increment(gained),
        allPoints: FieldValue.increment(gained),
        ...totals,
      },
    },
    { merge: true },
  );

  const profileRef = doc(cluster, "profiles", wallet);
  tx.set(
    profileRef,
    {
      wallet,
      gbp: FieldValue.increment(gained),
      // Nested object, not a dotted key: set() treats "sources.fetch" as a
      // field whose name contains a dot, which is not what we want here.
      sources: { [game]: FieldValue.increment(gained) },
      updatedAt: FieldValue.serverTimestamp(),
      ...profile,
    },
    { merge: true },
  );

  for (const board of boards) {
    if (!board) continue;
    tx.set(
      col(cluster, "leaderboards").doc(board).collection("entries").doc(wallet),
      {
        wallet,
        points: FieldValue.increment(gained),
        plays: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (feed) publishFeed(tx, cluster, { wallet, game, ...feed });

  return gained;
}

/**
 * Post to the live activity feed.
 *
 * The feed is read directly by browsers through Firestore, so it carries only
 * what is already public: a wallet address and what it just did.
 */
export function publishFeed(tx, cluster, { wallet, game, type, text, points }) {
  const ref = col(cluster, "feed").doc();
  tx.set(ref, {
    type: type || game || "event",
    game: game || null,
    wallet: wallet || null,
    text,
    points: points ?? null,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
    expiresAt: new Date(Date.now() + FEED_TTL_MS),
  });
}

/**
 * A profile's rank standing, derived from its points.
 *
 * Rank is stored on the profile rather than derived on read so leaderboards and
 * the feed can show a badge without a second lookup per row; the daily job
 * refreshes it. This function is the single definition of the ladder maths, so
 * the API and the job cannot disagree about where someone sits.
 */
export function rankStanding(gbp = 0) {
  const rank = rankFor(gbp);
  const next = RANKS.find((candidate) => candidate.threshold > gbp) || null;
  return {
    rank: rank.key,
    rankName: rank.name,
    gbp,
    nextRank: next ? next.key : null,
    nextRankName: next ? next.name : null,
    pointsToNext: next ? next.threshold - gbp : 0,
    // Progress through the current band, as a percentage, for the rank bar.
    progressPct: next
      ? Math.min(
          100,
          Math.floor(((gbp - rank.threshold) * 100) / (next.threshold - rank.threshold)),
        )
      : 100,
  };
}

/**
 * A wallet's position on a board: how many entries beat it, plus one.
 *
 * Uses an aggregation query so it stays a single cheap round trip no matter how
 * many players there are.
 */
export async function boardPosition(cluster, board, points) {
  if (!points) return null;
  const snapshot = await col(cluster, "leaderboards")
    .doc(board)
    .collection("entries")
    .where("points", ">", points)
    .count()
    .get();
  return snapshot.data().count + 1;
}

export async function topOfBoard(cluster, board, limit = 25) {
  const snapshot = await col(cluster, "leaderboards")
    .doc(board)
    .collection("entries")
    .orderBy("points", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((entry, index) => ({ position: index + 1, ...entry.data() }));
}
