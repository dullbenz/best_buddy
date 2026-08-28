/**
 * One trick, played inside the standard shell.
 *
 * The page owns the state machine and the per-item clock: an item's tick is
 * the raw milliseconds from render to answer, and the raw total must account
 * for the wall time the server measured — the speed bonus belongs to whoever
 * answers fastest, not whoever edits the payload.
 */
import React, { useCallback, useRef, useState } from "react";

import { TRICKS_LIMITS } from "@game-core/tricks-sim.js";
import { GameShell, HudItem } from "../../components/GameShell";
import { LeaderboardTable } from "../../components/LeaderboardTable";
import { SignInPrompt } from "../../components/HubHeader";
import { EmptyState, WalletChip } from "../../components/ui";
import {
  ApiError,
  api,
  type Leaderboard,
  type TrickDetail,
  type TrickResult,
  type TrickStart,
} from "../../lib/api";
import { useSession } from "../../lib/auth";
import { commas } from "../../lib/format";
import { usePoll } from "../../lib/poll";
import { QuizItem, ScrambleItem, RiddleItem } from "./players";
import { RatePanel } from "./RatePanel";
import { TrickStats } from "./common";

type Phase = "idle" | "playing" | "done";

export default function TrickPlayPage({ trickId }: { trickId: string }) {
  const { signedIn, isGuest, playerId, refresh } = useSession();

  const detail = usePoll<TrickDetail>(() => api.trick(trickId), 60000, [trickId, signedIn]);
  const board = usePoll<Leaderboard>(
    () => api.leaderboard(`tricks:game:${trickId}`, 10),
    60000,
    [trickId, signedIn],
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [started, setStarted] = useState<TrickStart | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<TrickResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  const answers = useRef<(string | number)[]>([]);
  const ticks = useRef<number[]>([]);
  const itemShownAt = useRef(0);

  const trick = detail.data?.trick || null;
  const you = detail.data?.you || null;

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const opened = await api.trickStart(trickId);
      answers.current = [];
      ticks.current = [];
      setStarted(opened);
      setIndex(0);
      setResult(null);
      setPhase("playing");
      itemShownAt.current = Date.now();
    } catch (caught: any) {
      if (caught instanceof ApiError && caught.code === "ALREADY_PLAYED") {
        setError("One attempt a day — you've had yours. Come back tomorrow.");
      } else {
        setError(caught?.message || "Couldn't start the trick.");
      }
    } finally {
      setBusy(false);
    }
  }, [trickId]);

  const onAnswer = useCallback(
    async (value: string | number) => {
      if (!trick || !started) return;
      answers.current.push(value);
      ticks.current.push(Date.now() - itemShownAt.current);
      itemShownAt.current = Date.now();

      if (answers.current.length < trick.itemCount) {
        setIndex(answers.current.length);
        return;
      }

      setBusy(true);
      try {
        const scored = await api.trickPlay(trickId, answers.current, ticks.current);
        setResult(scored);
        setPhase("done");
        board.reload();
        void refresh();
      } catch (caught: any) {
        setError(caught?.message || "That attempt couldn't be recorded.");
        setPhase("idle");
      } finally {
        setBusy(false);
      }
    },
    [trick, started, trickId, board.reload, refresh],
  );

  const report = useCallback(async () => {
    try {
      await api.trickReport(trickId);
      setReported(true);
    } catch {
      // A failed flag is not worth an error state; the button just stays.
    }
  }, [trickId]);

  if (detail.error) {
    return (
      <GameShell game="tricks" title="New Tricks" rules={<p>That trick is not on the shelf.</p>}>
        <EmptyState message="That trick isn't on the shelf. It may still be in review." />
      </GameShell>
    );
  }
  if (!trick) {
    return (
      <GameShell game="tricks" title="New Tricks" rules={<p>Loading.</p>}>
        <EmptyState kind="loading" message="fetching the trick" />
      </GameShell>
    );
  }

  const item = trick.items[index];
  const revealFor = (position: number): string => {
    if (!result) return "";
    const revealed = result.answers[position];
    if (trick.template === "quiz") {
      return trick.items[position].options?.[revealed as number] ?? String(revealed);
    }
    return String(revealed);
  };

  return (
    <GameShell
      game="tricks"
      title={trick.title}
      rules={
        <>
          <p>{trick.intro || "A community-made trick."}</p>
          <p>
            One attempt per day. Answering fast earns a speed bonus on every correct item — up to{" "}
            {TRICKS_LIMITS.pointsPerCorrect + TRICKS_LIMITS.speedBonusMax} points each.
          </p>
          <p className="muted">
            made by the community — if this trick is offensive or broken, flag it below.
          </p>
        </>
      }
      hud={
        <>
          <HudItem
            label="progress"
            value={phase === "playing" ? `${index + 1} / ${trick.itemCount}` : `${trick.itemCount} items`}
          />
          <HudItem label="score" value={commas(result?.score ?? 0)} />
        </>
      }
      below={
        <section className="card">
          <span className="label">all-time board for this trick</span>
          <div style={{ marginTop: 10 }}>
            <LeaderboardTable
              board={board.data}
              you={playerId}
              emptyMessage="Nobody has scored on this one yet. Be first."
            />
          </div>
        </section>
      }
    >
      <SignInPrompt reason="Sign in or play as a guest to take today's attempt." allowGuest />

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
        </div>
      )}

      {phase === "idle" && (
        <div className="stage" style={{ padding: "36px 20px", textAlign: "center" }}>
          <h2 className="serif" style={{ fontSize: 24, margin: "0 0 4px" }}>
            {trick.title}
          </h2>
          <TrickStats summary={trick} />
          <p className="muted" style={{ maxWidth: 420, margin: "10px auto 20px" }}>
            by <WalletChip address={trick.payoutWallet} />
          </p>
          {signedIn ? (
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void start()}>
              {you?.scoredToday ? "played today" : started ? "resume" : "play"}
            </button>
          ) : (
            <p className="label">sign in above — a guest session is one click</p>
          )}
        </div>
      )}

      {phase === "playing" && item && (
        <div className="stage" style={{ padding: "28px 20px" }}>
          <span className="label">
            {index + 1} of {trick.itemCount} · answer fast for bonus points
          </span>
          <div style={{ marginTop: 14 }}>
            {trick.template === "quiz" && <QuizItem item={item} onAnswer={onAnswer} />}
            {trick.template === "scramble" && (
              <ScrambleItem
                item={item}
                letters={started?.extras?.[index]?.letters || ""}
                onAnswer={onAnswer}
              />
            )}
            {trick.template === "riddle" && <RiddleItem item={item} onAnswer={onAnswer} />}
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <>
          <div className="card">
            <div className="spread">
              <div>
                <span className="label">trick complete</span>
                <div className="big-number">{commas(result.score)}</div>
                <span className="muted" style={{ fontSize: 13 }}>
                  {result.correct.filter(Boolean).length} of {trick.itemCount} correct
                  {!isGuest && result.pointsAwarded > 0
                    ? ` · ${commas(result.pointsAwarded)} GBP earned${result.capped ? " (daily cap)" : ""}`
                    : ""}
                  {isGuest ? " · sign in with a wallet to earn GBP" : ""}
                </span>
              </div>
            </div>

            <table className="ledger" style={{ marginTop: 12 }}>
              <tbody>
                {result.correct.map((wasCorrect, position) => (
                  <tr key={position}>
                    <td className="mono muted" style={{ width: 34 }}>
                      {position + 1}
                    </td>
                    <td>{wasCorrect ? "✓" : `✗ — it was "${revealFor(position)}"`}</td>
                    <td className="num">{commas(result.perItem[position])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {you && !you.isCreator && (
            <RatePanel trickId={trickId} alreadyRated={you.rated} onRated={() => detail.reload()} />
          )}

          <p className="label" style={{ marginTop: 12 }}>
            {reported ? (
              "flagged — thank you, a reviewer will look"
            ) : (
              <button
                className="btn"
                style={{ border: "none", background: "none", padding: 0, textDecoration: "underline" }}
                onClick={() => void report()}
              >
                flag this trick
              </button>
            )}
          </p>
        </>
      )}
    </GameShell>
  );
}
