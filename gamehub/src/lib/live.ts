/**
 * Live reads, straight from Firestore.
 *
 * The pet counter, the activity feed and the leaderboards are public data that
 * changes constantly. Subscribing to them directly means they update the moment
 * they change, with no function invocation per viewer — the counter feels alive
 * because it is, not because something is polling it every ten seconds.
 *
 * Writes never happen here. Security rules allow reads on exactly these
 * collections and nothing else; everything that awards a point goes through the
 * API.
 */
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { CLUSTER } from "../config";
import { db, firebaseReady } from "./firebase";
import type { FeedEvent } from "./api";

const rootPath = () => ["gamehub", CLUSTER] as const;

/**
 * The global pet total.
 *
 * The counter is sharded across twenty documents because a single document
 * cannot absorb the write rate of a community all petting at once. Readers add
 * the shards up; this is that addition.
 */
export function usePetTotal(): { total: number | null; live: boolean } {
  const [total, setTotal] = useState<number | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!firebaseReady()) return undefined;
    const [root, cluster] = rootPath();
    const shards = collection(db(), root, cluster, "petShards");

    return onSnapshot(
      shards,
      (snapshot) => {
        let sum = 0;
        snapshot.forEach((shard) => {
          sum += shard.data().count || 0;
        });
        setTotal(sum);
        setLive(true);
      },
      () => setLive(false),
    );
  }, []);

  return { total, live };
}

/** The milestone marker, maintained by the aggregator job. */
export function usePetMilestones() {
  const [state, setState] = useState<{ lastMilestone: number; nextMilestone: number | null }>({
    lastMilestone: 0,
    nextMilestone: null,
  });

  useEffect(() => {
    if (!firebaseReady()) return undefined;
    const [root, cluster] = rootPath();
    return onSnapshot(doc(db(), root, cluster, "counters", "globalPets"), (snapshot) => {
      const data = snapshot.data();
      if (data) {
        setState({
          lastMilestone: data.lastMilestone || 0,
          nextMilestone: data.nextMilestone ?? null,
        });
      }
    });
  }, []);

  return state;
}

export function useFeed(count = 12): FeedEvent[] {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    if (!firebaseReady()) return undefined;
    const [root, cluster] = rootPath();
    const recent = query(
      collection(db(), root, cluster, "feed"),
      orderBy("createdAtMs", "desc"),
      fsLimit(count),
    );

    return onSnapshot(recent, (snapshot) => {
      setEvents(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            type: data.type,
            wallet: data.wallet ?? null,
            text: data.text,
            points: data.points ?? null,
            createdAtMs: data.createdAtMs || 0,
          };
        }),
      );
    });
  }, [count]);

  return events;
}
