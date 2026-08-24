/**
 * Best Boy Reputation — the meta layer.
 *
 * Good Boy Points accumulate from every game and from staking, and they buy
 * exactly one thing: standing. The ladder runs Stray → Puppy → Good Boy → Best
 * Buddy → Legendary Dog → Immortal Dog, and a wallet's rank badge follows it
 * everywhere in the hub.
 *
 * Staking points accrue daily rather than instantly, so rank reflects holding
 * through time rather than a balance held for the length of one page load.
 */
import { col, doc, dayId, FieldValue, RANKS, readConfig } from "../db.js";
import { boardPosition, rankStanding, topOfBoard } from "../points.js";
import { handler, notFound } from "../middleware.js";
import { parseAddress } from "../auth.js";
import { getStakeStatus } from "../stake.js";

/**
 * Daily points for a staked position.
 *
 * Logarithmic in size: a whale should out-rank a small holder, but not by the
 * ratio of their balances, or the ladder would only ever describe the top ten
 * wallets. Doubling your stake is worth a fixed step, not a multiple.
 */
export function stakingPointsForDay(totalAmountBaseUnits) {
  const amount = Number(totalAmountBaseUnits || 0) / 1e6; // $BUDDY has 6 decimals
  if (amount <= 0) return 0;
  const points = Math.floor(60 * Math.log10(1 + amount / 1000));
  return Math.max(10, Math.min(600, points));
}

export async function profileFor(cluster, wallet) {
  const [profileSnapshot, playerSnapshot] = await Promise.all([
    doc(cluster, "profiles", wallet).get(),
    doc(cluster, "players", wallet).get(),
  ]);

  const profile = profileSnapshot.exists ? profileSnapshot.data() : { wallet, gbp: 0 };
  const player = playerSnapshot.exists ? playerSnapshot.data() : {};
  const standing = rankStanding(profile.gbp || 0);

  return {
    wallet,
    ...standing,
    sources: profile.sources || {},
    petCount: profile.petCount || 0,
    wins: profile.wins || 0,
    losses: profile.losses || 0,
    draws: profile.draws || 0,
    streakDays: player.fetch?.streakDays || 0,
    longestStreak: player.fetch?.longestStreak || 0,
    runnerBest: player.runner?.personalBest || 0,
    totals: player.totals || {},
  };
}

export function mountReputationRoutes(app, cluster) {
  /** The public rank API. Any page, including the main site, can call this. */
  app.get(
    "/reputation/:wallet",
    handler(async (req, res) => {
      const { wallet } = req.params;
      if (!parseAddress(wallet)) throw notFound("BAD_WALLET", "That is not a Solana address.");

      const profile = await profileFor(cluster, wallet);
      const position = await col(cluster, "profiles")
        .where("gbp", ">", profile.gbp)
        .count()
        .get()
        .then((snapshot) => snapshot.data().count + 1)
        .catch(() => null);

      res.json({ ...profile, position, ladder: RANKS });
    }),
  );

  app.get(
    "/ranks",
    handler(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const snapshot = await col(cluster, "profiles").orderBy("gbp", "desc").limit(limit).get();
      res.json({
        ladder: RANKS,
        top: snapshot.docs.map((entry, index) => {
          const data = entry.data();
          return {
            position: index + 1,
            wallet: data.wallet,
            gbp: data.gbp || 0,
            rank: rankStanding(data.gbp || 0).rank,
          };
        }),
      });
    }),
  );

  app.get(
    "/leaderboard/:board",
    handler(async (req, res) => {
      const board = req.params.board;
      if (!/^[a-z]+:[a-z]+:[A-Za-z0-9-]+$/.test(board)) {
        throw notFound("BAD_BOARD", "No such leaderboard.");
      }
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const [top, meta] = await Promise.all([
        topOfBoard(cluster, board, limit),
        doc(cluster, "leaderboardMeta", board).get(),
      ]);

      let you = null;
      if (req.session?.wallet) {
        const entry = await col(cluster, "leaderboards")
          .doc(board)
          .collection("entries")
          .doc(req.session.wallet)
          .get();
        if (entry.exists) {
          const data = entry.data();
          you = { ...data, position: await boardPosition(cluster, board, data.points) };
        }
      }

      res.json({
        board,
        status: meta.exists ? meta.data().status : "open",
        endsAt: meta.exists ? meta.data().endsAtIso || null : null,
        top,
        you,
      });
    }),
  );
}

/**
 * Award a day of staking points and refresh stored ranks.
 *
 * Only wallets seen in the last month are refreshed: rank is a picture of an
 * active community, and walking every profile every night would cost more than
 * it tells anyone.
 */
export async function accrueStakingPoints(cluster, { activeSinceDays = 30, limit = 500 } = {}) {
  const cutoff = new Date(Date.now() - activeSinceDays * 86400000);
  const players = await col(cluster, "players")
    .where("lastSeenAt", ">=", cutoff)
    .limit(limit)
    .get();

  const day = dayId(new Date());
  let credited = 0;
  let skipped = 0;

  for (const snapshot of players.docs) {
    const wallet = snapshot.id;
    const alreadyToday = snapshot.data()?.staking?.day === day;
    if (alreadyToday) {
      skipped++;
      continue;
    }

    const stake = await getStakeStatus(cluster, wallet, { force: true });
    if (stake.source === "unavailable") {
      // No answer from the chain is not the same as "not staked": skip rather
      // than quietly deny someone their day's points.
      skipped++;
      continue;
    }

    const points = stake.staked ? stakingPointsForDay(stake.totalAmount) : 0;
    const profileRef = doc(cluster, "profiles", wallet);

    if (points > 0) {
      await profileRef.set(
        {
          wallet,
          gbp: FieldValue.increment(points),
          sources: { staking: FieldValue.increment(points) },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      credited++;
    }

    await snapshot.ref.set({ staking: { day, points } }, { merge: true });
  }

  // Ranks are stored so badges render without recomputing; refresh them after
  // the night's points have landed.
  const profiles = await col(cluster, "profiles").orderBy("gbp", "desc").limit(limit).get();
  const batch = [];
  for (const snapshot of profiles.docs) {
    const standing = rankStanding(snapshot.data().gbp || 0);
    if (snapshot.data().rank !== standing.rank) {
      batch.push(snapshot.ref.set({ rank: standing.rank, rankName: standing.rankName }, { merge: true }));
    }
  }
  await Promise.all(batch);

  return { considered: players.size, credited, skipped, ranksUpdated: batch.length };
}
