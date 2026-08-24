/**
 * Buddy's Daily Fetch.
 *
 * Three scored throws a day and a streak that only survives if you come back
 * tomorrow. Practice is unlimited and unscored, so the daily three are never
 * wasted learning the controls — which is the difference between a habit and an
 * annoyance.
 */
import React, { useCallback, useEffect, useState } from "react";

import { GameShell, HudItem } from "../../components/GameShell";
import { LeaderboardTable } from "../../components/LeaderboardTable";
import { SignInPrompt } from "../../components/HubHeader";
import {
  CountdownClock,
  EmptyState,
  PerkLock,
  StreakFlame,
  Celebration,
} from "../../components/ui";
import { FetchStage, type Aim } from "./FetchStage";
import { api, ApiError, type FetchRound, type Leaderboard, type ThrowResult } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { commas, multiplierLabel } from "../../lib/format";
import { KEYS, read, write } from "../../lib/storage";
import { usePoll } from "../../lib/poll";
import { weekId } from "../../lib/period";
import { sfx } from "../../lib/sfx";

/** A stable, meaningless seed for practice throws — never sent anywhere. */
const PRACTICE_SEED = "7f".repeat(32);

export default function FetchPage() {
  const { signedIn, me, refresh } = useSession();

  const [round, setRound] = useState<FetchRound | null>(null);
  const [result, setResult] = useState<ThrowResult | null>(null);
  const [throwing, setThrowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfThrows, setOutOfThrows] = useState<{ resetsAt: string } | null>(null);
  // Signed in, but we do not yet know whether there is a round to play. The
  // stage must not present itself as practice in the meantime: a player would
  // take a throw believing it counted, and the stage would swap underneath
  // them when the round arrived.
  const [roundLoading, setRoundLoading] = useState(false);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceResult, setPracticeResult] = useState<ThrowResult | null>(null);
  const [rankUp, setRankUp] = useState<string | null>(null);
  const [guestBest, setGuestBest] = useState(() => read<number>(KEYS.guestFetch, 0));

  const board = usePoll<Leaderboard>(
    () => {
      const now = new Date();
      const week = weekId(now);
      return api.leaderboard(`fetch:weekly:${week}`, 10);
    },
    60000,
    [signedIn],
  );

  const startRound = useCallback(async () => {
    if (!signedIn) return;
    setError(null);
    setRoundLoading(true);
    try {
      setRound(await api.fetchStart());
      setOutOfThrows(null);
    } catch (caught: any) {
      if (caught instanceof ApiError && caught.code === "NO_THROWS_LEFT") {
        setOutOfThrows({ resetsAt: caught.details?.resetsAt });
        setRound(null);
      } else {
        setError(caught?.message || "Couldn't start a round.");
      }
    } finally {
      setRoundLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void startRound();
  }, [startRound]);

  const onThrow = useCallback(
    async (aim: Aim) => {
      if (!round || throwing) return;
      setThrowing(true);
      sfx.throw();

      try {
        const thrown = await api.fetchThrow(round.roundId, aim.angleQ, aim.powerQ);
        setResult(thrown);
        window.setTimeout(
          () => {
            if (thrown.grade === "perfect") sfx.perfect();
            else if (thrown.grade === "miss") sfx.miss();
            else sfx.good();
          },
          (thrown.flight.flightTicks / 60) * 1000,
        );

        // Let the flight play, then reset the stage for the next throw.
        window.setTimeout(
          () => {
            setResult(null);
            setThrowing(false);
            if (thrown.throwsRemaining > 0) {
              setRound((current) =>
                current
                  ? {
                      ...current,
                      throwIndex: thrown.throwIndex + 1,
                      throwsRemaining: thrown.throwsRemaining,
                      todayPoints: thrown.todayPoints,
                      field: thrown.nextField || current.field,
                    }
                  : current,
              );
            } else {
              setOutOfThrows({ resetsAt: thrown.resetsAt });
              setRound(null);
              void refresh();
            }
          },
          (thrown.flight.flightTicks / 60) * 1000 + 1400,
        );
      } catch (caught: any) {
        setThrowing(false);
        if (caught instanceof ApiError && caught.code === "NO_THROWS_LEFT") {
          setOutOfThrows({ resetsAt: caught.details?.resetsAt });
          setRound(null);
        } else {
          setError(caught?.message || "That throw didn't land.");
        }
      }
    },
    [round, throwing, refresh],
  );

  /** Guests and out-of-throws players still get to play, just not for points. */
  const onPracticeThrow = useCallback(
    async (aim: Aim) => {
      const { simulateThrow } = await import("@game-core/fetch-sim.js");
      const outcome = simulateThrow(PRACTICE_SEED, practiceIndex, aim, { mode: "normal" });
      const shaped = {
        ...outcome,
        multiplierX100: 100,
        throwIndex: practiceIndex,
        throwsRemaining: 0,
        todayPoints: 0,
        streakDays: 0,
        perfectStreak: 0,
        resetsAt: "",
        nextField: null,
      } as unknown as ThrowResult;

      setPracticeResult(shaped);
      window.setTimeout(() => {
        if (outcome.grade === "perfect") sfx.perfect();
        else if (outcome.grade === "miss") sfx.miss();
        else sfx.good();
      }, (outcome.flight.flightTicks / 60) * 1000);

      if (!signedIn && outcome.points > guestBest) {
        setGuestBest(outcome.points);
        write(KEYS.guestFetch, outcome.points);
      }

      window.setTimeout(
        () => {
          setPracticeResult(null);
          setPracticeIndex((index) => index + 1);
        },
        (outcome.flight.flightTicks / 60) * 1000 + 1400,
      );
    },
    [practiceIndex, signedIn, guestBest],
  );

  const scored = Boolean(round);
  const stageSeed = scored ? round!.seed : PRACTICE_SEED;
  const stageIndex = scored ? round!.throwIndex : practiceIndex;
  const stageField = scored ? round!.field : practiceField(practiceIndex);
  const stageResult = scored ? result : practiceResult;
  const waitingForRound = signedIn && !scored && !outOfThrows && (roundLoading || !error);

  return (
    <GameShell
      game="fetch"
      title="Daily Fetch"
      rules={
        <>
          <p>
            Drag back from the field and let go. Further back is more power; higher is more lift and
            more hang time.
          </p>
          <p>
            Buddy sprints for wherever it will land. The amber bar shows how far he can get in the
            time the ball is in the air — land it inside that band and he catches it.
          </p>
          <p>
            <strong>The closer to the edge of his reach, the better the catch.</strong> A ball he has
            to stretch for is <span className="tone-warn">PERFECT</span>. One he strolls to is only
            okay. One he can't reach at all is a miss.
          </p>
          <p>
            Three scored throws a day. Practice as much as you like — it never costs one. Come back
            tomorrow to keep the streak, and the streak multiplies everything.
          </p>
          <p className="muted">Keyboard: hold space for power, ↑ ↓ for angle, release to throw.</p>
        </>
      }
      hud={
        <>
          <HudItem
            label="throws"
            value={
              <span className="pips" aria-label={`${round?.throwsRemaining ?? 0} throws left`}>
                {Array.from({ length: round?.throwsPerDay ?? 3 }, (_, index) => (
                  <span
                    key={index}
                    className={`pip ${index >= (round?.throwsRemaining ?? 0) ? "pip-used" : ""}`}
                  />
                ))}
              </span>
            }
          />
          <HudItem label="today" value={commas(round?.todayPoints ?? 0)} />
          <HudItem
            label="multiplier"
            value={multiplierLabel(round?.multiplierX100 ?? 100)}
            tone="tone-warn"
          />
          <div className="hud-item" style={{ minWidth: 140 }}>
            <span className="label">streak</span>
            <StreakFlame
              days={round?.streakDays ?? me?.profile.streakDays ?? 0}
              // Only at risk while today's throws are untouched. Once one is
              // taken the streak is banked, and warning about it is a lie.
              endsAt={
                round && round.throwsRemaining === round.throwsPerDay ? round.resetsAt : null
              }
            />
          </div>
        </>
      }
      below={
        <section className="card">
          <span className="label">this week's fetchers</span>
          <div style={{ marginTop: 10 }}>
            <LeaderboardTable
              board={board.data}
              you={me?.wallet}
              emptyMessage="No throws recorded this week yet."
            />
          </div>
        </section>
      }
    >
      <SignInPrompt reason="Sign in to take your three scored throws." />

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
          <button className="btn" onClick={() => void startRound()}>
            try again
          </button>
        </div>
      )}

      {outOfThrows && (
        <div className="banner">
          <span>
            That's your three for today. Nice work — the streak is safe.{" "}
            <strong>
              <CountdownClock until={outOfThrows.resetsAt} prefix="fresh throws in" />
            </strong>
          </span>
        </div>
      )}

      {waitingForRound ? (
        <EmptyState kind="loading" message="finding a ball" />
      ) : (
        <FetchStage
          seed={stageSeed}
          throwIndex={stageIndex}
          field={stageField}
          mode={scored ? round!.mode : "normal"}
          disabled={throwing || Boolean(stageResult)}
          result={stageResult}
          onThrow={scored ? onThrow : onPracticeThrow}
          practice={!scored}
        />
      )}

      {!scored && !waitingForRound && (
        <p className="label">
          practice throws · nothing is recorded
          {!signedIn && guestBest > 0 && ` · your best practice throw: ${guestBest}`}
        </p>
      )}

      {round && !round.goldenEligible && (
        <PerkLock perk="Golden Bone" benefit="a gold ball worth half again as much on every catch" />
      )}

      {rankUp && (
        <Celebration stamp={rankUp} detail="You moved up the ladder." onClose={() => setRankUp(null)} />
      )}
    </GameShell>
  );
}

/** Practice fields vary per throw so practice is not one repeated puzzle. */
function practiceField(index: number) {
  return { buddyStartX: 4200 + ((index * 1237) % 4800), windPerTick: ((index * 37) % 61) - 30 };
}

