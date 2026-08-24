/**
 * Pet the Dog.
 *
 * The lowest-friction thing in the hub and, by design, the most social: one
 * Buddy, everyone's hands, one counter climbing all day.
 *
 * Two details carry it. The counter is live rather than polled, so the number
 * visibly moves while you sit there — that is the whole feeling. And a tap
 * during the cooldown gets an ear-flick instead of nothing: a dead click reads
 * as a broken page, a reaction reads as a dog who has had enough for a second.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

import { BuddyFace } from "../../components/buddy/BuddySprite";
import { GameShell, HudItem } from "../../components/GameShell";
import { LeaderboardTable } from "../../components/LeaderboardTable";
import { SignInPrompt } from "../../components/HubHeader";
import {
  Celebration,
  EmptyState,
  MilestoneBar,
  PerkLock,
  PointsDeltas,
  WalletChip,
  useDeltas,
} from "../../components/ui";
import { api, ApiError, type Leaderboard } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { useFeed, usePetMilestones, usePetTotal } from "../../lib/live";
import { commas } from "../../lib/format";
import { sfx } from "../../lib/sfx";
import { usePoll } from "../../lib/poll";

type Heart = { id: number; x: number; y: number; drift: number; spin: number };

export default function PetPage() {
  const { signedIn, me, refresh } = useSession();
  const { total, live } = usePetTotal();
  const { nextMilestone, lastMilestone } = usePetMilestones();
  const feed = useFeed(10);
  const { deltas, push } = useDeltas();

  const [hearts, setHearts] = useState<Heart[]>([]);
  const [happy, setHappy] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownMs, setCooldownMs] = useState(2500);
  const [localPets, setLocalPets] = useState(0);
  const [guestPets, setGuestPets] = useState(0);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const heartId = useRef(0);
  const zoneRef = useRef<HTMLDivElement>(null);
  const seenMilestone = useRef<number | null>(null);

  const board = usePoll<Leaderboard>(
    () => api.leaderboard(`pet:daily:${new Date().toISOString().slice(0, 10)}`, 10),
    60000,
    [signedIn],
  );

  // A frame loop only while cooling down, so the ring animates and stops.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    let frame = 0;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() < cooldownUntil) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cooldownUntil]);

  // Announce a community milestone the first time we see it cross.
  useEffect(() => {
    if (!lastMilestone) return;
    if (seenMilestone.current === null) {
      seenMilestone.current = lastMilestone;
      return;
    }
    if (lastMilestone > seenMilestone.current) {
      seenMilestone.current = lastMilestone;
      setCelebration(`${commas(lastMilestone)} pets`);
      sfx.milestone();
    }
  }, [lastMilestone]);

  const spawnHearts = useCallback((count: number, origin: { x: number; y: number }) => {
    const fresh: Heart[] = Array.from({ length: count }, () => ({
      id: heartId.current++,
      x: origin.x + (Math.random() * 60 - 30),
      y: origin.y,
      drift: Math.random() * 60 - 30,
      spin: Math.random() * 40 - 20,
    }));
    setHearts((current) => [...current, ...fresh]);
    window.setTimeout(
      () => setHearts((current) => current.filter((heart) => !fresh.some((one) => one.id === heart.id))),
      1150,
    );
  }, []);

  const doPet = useCallback(
    async (event: React.MouseEvent | React.KeyboardEvent, superPet = false) => {
      const bounds = zoneRef.current?.getBoundingClientRect();
      const point =
        "clientX" in event && bounds
          ? { x: (event as React.MouseEvent).clientX - bounds.left, y: (event as React.MouseEvent).clientY - bounds.top }
          : { x: (bounds?.width || 200) / 2, y: (bounds?.height || 200) / 2 };

      // Still cooling down: acknowledge the tap, award nothing.
      if (Date.now() < cooldownUntil) {
        setHappy(0.35);
        window.setTimeout(() => setHappy(0), 180);
        return;
      }

      setHappy(1);
      window.setTimeout(() => setHappy(0.15), 420);
      spawnHearts(superPet ? 14 : 6, point);
      superPet ? sfx.superPet() : sfx.pet();

      if (!signedIn) {
        // Guests get the whole feeling, just not the ledger.
        setGuestPets((count) => count + 1);
        setCooldownUntil(Date.now() + cooldownMs);
        return;
      }

      // Optimistic: the counter moves now, the server reconciles in a moment.
      setLocalPets((count) => count + (superPet ? 15 : 1));
      setCooldownUntil(Date.now() + cooldownMs);
      push(superPet ? 15 : 1, point.x, point.y);

      try {
        const result = superPet ? await api.superPet() : await api.pet();
        setCooldownUntil(result.cooldownUntil);
        setCooldownMs(Math.max(500, result.cooldownUntil - Date.now()));
        setError(null);
      } catch (caught: any) {
        // Roll the optimistic point back rather than leave a number that the
        // next page load will silently contradict.
        setLocalPets((count) => count - (superPet ? 15 : 1));
        if (caught instanceof ApiError && caught.code === "COOLDOWN") {
          setCooldownUntil(caught.details?.cooldownUntil || Date.now() + cooldownMs);
        } else if (caught instanceof ApiError && caught.code === "NOT_STAKED") {
          setError(caught.message);
        } else {
          setError(caught?.message || "That pet didn't register.");
        }
      }
    },
    [cooldownUntil, cooldownMs, signedIn, spawnHearts, push],
  );

  const cooling = now < cooldownUntil;
  const coolProgress = cooling ? 1 - (cooldownUntil - now) / cooldownMs : 1;
  const staked = me?.perks.superPet;
  const displayTotal = total === null ? null : total + localPets;

  return (
    <GameShell
      game="pet"
      title="Pet the Dog"
      rules={
        <>
          <p>Tap Buddy. That's the game.</p>
          <p>
            Every pet is worth a point and a spot on the daily board. There's a couple of seconds
            between pets — he's a dog, not a machine.
          </p>
          <p>
            Stakers get <strong>Super Pet</strong>: a much bigger fuss, worth fifteen, on a longer
            cooldown.
          </p>
          <p className="muted">
            Every pet in the hub counts toward one shared total. The milestones belong to everyone.
          </p>
        </>
      }
      hud={
        <>
          <HudItem label="your pets" value={commas((me?.profile.petCount || 0) + localPets)} />
          <HudItem label="today" value={commas(signedIn ? localPets : guestPets)} />
          <HudItem
            label="global"
            value={displayTotal === null ? "…" : commas(displayTotal)}
            tone="tone-warn"
          />
        </>
      }
      below={
        <>
          <section className="card">
            <span className="label">the pack, today</span>
            <div style={{ marginTop: 10 }}>
              <LeaderboardTable
                board={board.data}
                you={me?.wallet}
                unit="pets"
                emptyMessage="No pets yet today. Someone has to go first."
              />
            </div>
          </section>

          <section className="card" aria-live="polite">
            <span className="label">just now</span>
            {feed.length === 0 ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                Quiet in here.
              </p>
            ) : (
              <ul className="feed" style={{ marginTop: 8 }}>
                {feed.map((event) => (
                  <li key={event.id}>
                    {event.wallet ? (
                      <WalletChip address={event.wallet} you={event.wallet === me?.wallet} />
                    ) : (
                      <span className="chip">pack</span>
                    )}
                    <span className="feed-text">{event.text}</span>
                    {event.points ? <span className="feed-points">+{event.points}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      }
    >
      <SignInPrompt reason="Sign in and your pets start counting." />

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
        </div>
      )}

      <div className="stage" style={{ padding: "26px 16px 20px" }}>
        <div className="stage-note">{live ? "live" : "counting"}</div>

        <div
          className={`pet-zone ${staked ? "pet-zone-golden" : ""}`}
          ref={zoneRef}
          style={{ position: "relative" }}
        >
          <button
            onClick={(event) => void doPet(event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void doPet(event);
              }
            }}
            aria-label="Pet Buddy"
            style={{
              background: "none",
              border: 0,
              padding: 0,
              cursor: cooling ? "default" : "pointer",
            }}
          >
            <BuddyFace size={Math.min(300, typeof window === "undefined" ? 260 : window.innerWidth * 0.62)} happy={happy} golden={staked} />
          </button>

          {cooling && (
            <svg className="cooldown-ring" viewBox="0 0 100 100" aria-hidden="true">
              <circle
                cx="50"
                cy="50"
                r="48"
                strokeDasharray={`${coolProgress * 301.6} 301.6`}
              />
            </svg>
          )}

          {hearts.map((heart) => (
            <span
              key={heart.id}
              className="heart"
              style={{
                left: heart.x,
                top: heart.y,
                ["--drift" as any]: `${heart.drift}px`,
                ["--spin" as any]: `${heart.spin}deg`,
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--rust)" aria-hidden="true">
                <path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z" />
              </svg>
            </span>
          ))}

          <PointsDeltas deltas={deltas} />
        </div>

        <p className="label" style={{ textAlign: "center", marginTop: 4 }}>
          {!signedIn
            ? "not counted — sign in to be counted"
            : cooling
              ? "he's enjoying that one"
              : "tap him"}
        </p>
      </div>

      {staked ? (
        <button
          className="btn btn-primary"
          onClick={(event) => void doPet(event, true)}
          disabled={cooling}
          style={{ alignSelf: "flex-start" }}
        >
          super pet · +15
        </button>
      ) : (
        <PerkLock perk="Super Pet" benefit="a much bigger fuss, worth fifteen points" />
      )}

      <section className="card">
        <span className="label">the whole pack, all time</span>
        <div style={{ marginTop: 10 }}>
          <MilestoneBar
            current={displayTotal ?? 0}
            target={nextMilestone}
            label={
              nextMilestone
                ? `${commas(Math.max(0, nextMilestone - (displayTotal ?? 0)))} pets to the next milestone`
                : "every milestone reached"
            }
          />
        </div>
      </section>

      {celebration && (
        <Celebration
          stamp={celebration}
          detail="The pack hit a milestone together. Good boys, all of you."
          onClose={() => setCelebration(null)}
        />
      )}
    </GameShell>
  );
}
