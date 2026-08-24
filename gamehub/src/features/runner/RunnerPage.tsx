/**
 * Buddy vs. The Rugs.
 *
 * The cathartic one. Buddy runs, the bad ideas of the last cycle come at him,
 * and you jump them.
 *
 * Guests play the same game with the same seed handling; their scores stay on
 * their own device. Signing in is what puts a run on the weekly board.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

import { RUNNER_ACTIONS } from "@game-core/runner-sim.js";
import { GameShell, HudItem } from "../../components/GameShell";
import { LeaderboardTable } from "../../components/LeaderboardTable";
import { SignInPrompt } from "../../components/HubHeader";
import { RunnerCanvas, type RunHandle, type RunOver } from "./RunnerCanvas";
import { api, type Leaderboard } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { commas } from "../../lib/format";
import { KEYS, read, write } from "../../lib/storage";
import { usePoll } from "../../lib/poll";
import { weekId } from "../../lib/period";

type Phase = "idle" | "running" | "over";

export default function RunnerPage() {
  const { signedIn, me, refresh } = useSession();

  const [phase, setPhase] = useState<Phase>("idle");
  const [seed, setSeed] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [live, setLive] = useState({ score: 0, bones: 0, distance: 0 });
  const [outcome, setOutcome] = useState<{
    score: number;
    bones: number;
    points?: number;
    personalBest?: number;
    isPersonalBest?: boolean;
    recorded: boolean;
    note?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestBest, setGuestBest] = useState(() => read<number>(KEYS.guestRunner, 0));

  const handle = useRef<RunHandle>(null);
  const startedAt = useRef(0);

  const board = usePoll<Leaderboard>(
    () => api.leaderboard(`runner:weekly:${weekId(new Date())}`, 10),
    60000,
    [signedIn],
  );
  const reloadBoard = board.reload;

  const start = useCallback(async () => {
    setError(null);
    setOutcome(null);
    setLive({ score: 0, bones: 0, distance: 0 });
    startedAt.current = Date.now();

    if (signedIn) {
      try {
        const started = await api.runnerStart();
        setRunId(started.runId);
        setSeed(started.seed);
        setPhase("running");
        return;
      } catch (caught: any) {
        setError(caught?.message || "Couldn't start a run.");
        return;
      }
    }

    // Guests get a locally generated seed; nothing is submitted.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setRunId(null);
    setSeed(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    setPhase("running");
  }, [signedIn]);

  const onOver = useCallback(
    async (result: RunOver) => {
      setPhase("over");

      if (!signedIn || !runId) {
        const best = Math.max(guestBest, result.score);
        setGuestBest(best);
        write(KEYS.guestRunner, best);
        setOutcome({
          score: result.score,
          bones: result.bones,
          recorded: false,
          personalBest: best,
          isPersonalBest: result.score >= best && result.score > 0,
        });
        return;
      }

      try {
        const submitted = await api.runnerSubmit(runId, result.inputs, result.score);
        setOutcome({
          score: submitted.score,
          bones: submitted.bones,
          points: submitted.points,
          personalBest: submitted.personalBest,
          isPersonalBest: submitted.isPersonalBest,
          recorded: true,
        });
        void refresh();
        reloadBoard();
      } catch (caught: any) {
        setOutcome({
          score: result.score,
          bones: result.bones,
          recorded: false,
          note: caught?.message || "That run couldn't be recorded.",
        });
      }
    },
    // Depends on the stable reload function, not the poll result: this callback
    // is what drives the canvas effect, and a new identity restarts the run.
    [signedIn, runId, guestBest, refresh, reloadBoard],
  );

  /* Keyboard controls, live only while running. */
  useEffect(() => {
    if (phase !== "running") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "ArrowUp" || event.key === "w") {
        event.preventDefault();
        handle.current?.press(RUNNER_ACTIONS.JUMP);
      } else if (event.key === "ArrowDown" || event.key === "s") {
        event.preventDefault();
        handle.current?.press(RUNNER_ACTIONS.SLIDE);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  /* Touch: tap anywhere jumps, a downward swipe slides. */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    if (phase !== "running" || !touchStart.current) return;
    const touch = event.changedTouches[0];
    const dy = touch.clientY - touchStart.current.y;
    handle.current?.press(dy > 40 ? RUNNER_ACTIONS.SLIDE : RUNNER_ACTIONS.JUMP);
    touchStart.current = null;
  };

  return (
    <GameShell
      game="runner"
      title="Buddy vs. The Rugs"
      rules={
        <>
          <p>Buddy runs. You keep him upright.</p>
          <p>
            <strong>Jump</strong> the rolled rugs and the "DEV SOLD" signs.{" "}
            <strong>Slide</strong> under the broken charts. Collect bones on the way — they are worth
            25 each.
          </p>
          <p>He gets faster the longer he lasts. One hit ends the run.</p>
          <p className="muted">
            Keyboard: space or ↑ to jump, ↓ to slide. Touch: tap to jump, swipe down to slide.
          </p>
        </>
      }
      hud={
        <>
          <HudItem label="score" value={commas(phase === "over" ? outcome?.score ?? 0 : live.score)} />
          <HudItem label="bones" value={commas(phase === "over" ? outcome?.bones ?? 0 : live.bones)} />
          <HudItem
            label="your best"
            value={commas(signedIn ? me?.profile.runnerBest || 0 : guestBest)}
            tone="tone-warn"
          />
        </>
      }
      below={
        <section className="card">
          <span className="label">this week's tournament</span>
          <div style={{ marginTop: 10 }}>
            <LeaderboardTable
              board={board.data}
              you={me?.wallet}
              emptyMessage="No runs recorded this week. The board is wide open."
            />
          </div>
        </section>
      }
    >
      <SignInPrompt reason="Sign in to put your runs on the weekly board." />

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
        </div>
      )}

      {phase === "idle" && (
        <div className="stage" style={{ padding: "44px 20px", textAlign: "center" }}>
          <h2 className="serif" style={{ fontSize: 26, margin: "0 0 6px" }}>
            Buddy vs. The Rugs
          </h2>
          <p className="muted" style={{ maxWidth: 420, margin: "0 auto 20px" }}>
            Every rug he clears is one that didn't get pulled. Go as far as you can.
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => void start()}>
            play
          </button>
        </div>
      )}

      {phase !== "idle" && seed && (
        <div className="stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <RunnerCanvas ref={handle} seed={seed} onTick={setLive} onOver={onOver} />

          {phase === "running" && (
            <div className="runner-controls">
              <button
                onClick={() => handle.current?.press(RUNNER_ACTIONS.SLIDE)}
                aria-label="Slide"
              >
                slide
              </button>
              <button onClick={() => handle.current?.press(RUNNER_ACTIONS.JUMP)} aria-label="Jump">
                jump
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "over" && outcome && (
        <div className="card">
          <div className="spread">
            <div>
              <span className="label">run over</span>
              <div className="big-number">{commas(outcome.score)}</div>
              <span className="muted" style={{ fontSize: 13 }}>
                {commas(outcome.bones)} bones collected
                {outcome.points ? ` · ${commas(outcome.points)} points earned` : ""}
              </span>
            </div>
            {outcome.isPersonalBest && (
              <span className="chip" style={{ fontSize: 11 }}>
                new best
              </span>
            )}
          </div>

          {!outcome.recorded && (
            <p className="label" style={{ marginTop: 10 }}>
              {outcome.note || "not recorded — sign in to enter the weekly tournament"}
            </p>
          )}

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={() => void start()}>
              run again
            </button>
            <a
              className="btn"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `Buddy made it ${commas(outcome.score)} past the rugs. gamehub.mybestbuddy.fun`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              share
            </a>
          </div>
        </div>
      )}
    </GameShell>
  );
}

