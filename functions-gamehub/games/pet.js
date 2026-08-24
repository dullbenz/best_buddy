/**
 * Pet the Dog.
 *
 * One shared Buddy the whole community pets. A pet is worth a point, with a
 * short cooldown so it stays a gesture rather than a clicker. Stakers can Super
 * Pet: worth much more, on a much longer cooldown.
 *
 * The global counter is sharded. A single document has a sustained write limit
 * of roughly one per second, which is exactly the shape of traffic this game
 * produces, so the count is spread over twenty documents and summed by readers.
 * Browsers subscribe to the shards directly through Firestore and add them up
 * client-side, which is why the counter feels live without this function being
 * involved in a single read.
 */
import { col, doc, db, FieldValue, readConfig } from "../db.js";
import { awardPoints } from "../points.js";
import {
  forbidden,
  handler,
  requireRequestId,
  runIdempotent,
  tooMany,
} from "../middleware.js";
import { getStakeStatus } from "../stake.js";
import { dayId, weekId, boardId } from "../db.js";

export const PET_SHARD_COUNT = 20;

function randomShard() {
  return String(Math.floor(Math.random() * PET_SHARD_COUNT));
}

async function pet(cluster, { wallet, uid, requestId, superPet }) {
  const config = await readConfig(cluster);
  const cooldownMs = superPet ? config.superPetCooldownMs : config.petCooldownMs;
  const points = superPet ? config.superPetPoints : 1;

  if (superPet) {
    const stake = await getStakeStatus(cluster, wallet);
    if (!stake.staked) {
      throw forbidden(
        "NOT_STAKED",
        "Super Pet is for stakers. Stake any amount of $BUDDY to unlock it.",
      );
    }
  }

  const now = Date.now();
  const stateRef = doc(cluster, "petState", wallet);
  const field = superPet ? "lastSuperPetAtMs" : "lastPetAtMs";

  const { response } = await runIdempotent(cluster, uid, requestId, async (tx) => {
    const snapshot = await tx.get(stateRef);
    const state = snapshot.exists ? snapshot.data() : {};
    const last = state[field] || 0;
    const readyAt = last + cooldownMs;
    if (readyAt > now) {
      // Thrown inside the transaction so no counter is touched.
      throw tooMany("COOLDOWN", "Buddy is still enjoying the last one.", {
        cooldownUntil: readyAt,
        retryAfterMs: readyAt - now,
      });
    }

    tx.set(
      stateRef,
      {
        wallet,
        [field]: now,
        petCount: FieldValue.increment(1),
        superPetCount: FieldValue.increment(superPet ? 1 : 0),
      },
      { merge: true },
    );

    tx.set(
      col(cluster, "petShards").doc(randomShard()),
      { count: FieldValue.increment(1) },
      { merge: true },
    );

    const day = dayId(new Date(now));
    const week = weekId(new Date(now));
    awardPoints(tx, cluster, {
      wallet,
      game: "pet",
      points,
      boards: [
        boardId("pet", "daily", day),
        boardId("pet", "weekly", week),
        boardId("pet", "alltime", "all"),
      ],
      profile: { petCount: FieldValue.increment(1) },
      feed: superPet
        ? { type: "superPet", text: "gave Buddy a Super Pet", points }
        : { type: "pet", text: "pet Buddy", points },
    });

    return {
      points,
      superPet: Boolean(superPet),
      cooldownUntil: now + cooldownMs,
      petAtMs: now,
    };
  });

  return response;
}

export function mountPetRoutes(app, cluster, { rateLimits }) {
  app.post(
    "/pet",
    rateLimits.pet,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      res.json(
        await pet(cluster, {
          wallet: req.session.wallet,
          uid: req.session.uid,
          requestId,
          superPet: false,
        }),
      );
    }),
  );

  app.post(
    "/pet/super",
    rateLimits.pet,
    handler(async (req, res) => {
      const requestId = requireRequestId(req);
      res.json(
        await pet(cluster, {
          wallet: req.session.wallet,
          uid: req.session.uid,
          requestId,
          superPet: true,
        }),
      );
    }),
  );

  /**
   * The counter, for clients that would rather ask once than subscribe — the
   * hub itself reads the shards live.
   */
  app.get(
    "/pet/state",
    handler(async (req, res) => {
      const [shards, counter] = await Promise.all([
        col(cluster, "petShards").get(),
        doc(cluster, "counters", "globalPets").get(),
      ]);
      const total = shards.docs.reduce((sum, shard) => sum + (shard.data().count || 0), 0);
      const config = await readConfig(cluster);
      const nextMilestone = config.milestones.find((milestone) => milestone > total) || null;
      res.json({
        totalPets: total,
        nextMilestone,
        lastMilestone: counter.exists ? counter.data().lastMilestone || null : null,
        shardCount: PET_SHARD_COUNT,
      });
    }),
  );
}

/**
 * Fold the shards into one readable total and announce milestones.
 *
 * Runs on a schedule rather than on every pet: the shards are the truth, this
 * is the summary, and a minute of lag on a community counter is invisible.
 */
export async function aggregatePets(cluster) {
  const config = await readConfig(cluster);
  const shards = await col(cluster, "petShards").get();
  const total = shards.docs.reduce((sum, shard) => sum + (shard.data().count || 0), 0);

  const counterRef = doc(cluster, "counters", "globalPets");
  const crossed = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(counterRef);
    const previous = snapshot.exists ? snapshot.data().lastMilestone || 0 : 0;
    const reached = config.milestones.filter(
      (milestone) => milestone <= total && milestone > previous,
    );
    const highest = reached.length ? Math.max(...reached) : previous;

    tx.set(
      counterRef,
      {
        total,
        lastMilestone: highest,
        nextMilestone: config.milestones.find((milestone) => milestone > total) || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return reached;
  });

  for (const milestone of crossed) {
    await col(cluster, "feed").add({
      type: "milestone",
      game: "pet",
      wallet: null,
      text: `The pack reached ${milestone.toLocaleString("en-US")} pets`,
      points: null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
  }

  return { total, crossed };
}
