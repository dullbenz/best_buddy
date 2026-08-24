/**
 * Fetch Tournament — asynchronous head-to-head.
 *
 * Both players throw against the same seed, so the wind and Buddy's starting
 * spot are identical for each. Nobody has to be online at the same time, which
 * is the only match format that works for a community spread across every
 * timezone.
 */
import React, { useCallback, useState } from "react";

import { GameShell, HudItem } from "../../components/GameShell";
import { SignInPrompt } from "../../components/HubHeader";
import { CountdownClock, WalletChip } from "../../components/ui";
import { BuddySprite } from "../../components/buddy/BuddySprite";
import { HiddenBone } from "../hunt/hiddenBones";
import { FetchStage, type Aim } from "../fetch/FetchStage";
import { api, type Challenge } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { usePoll } from "../../lib/poll";
import { sfx } from "../../lib/sfx";
import { shortAddress } from "../../lib/format";

type Playing = {
  challengeId: string;
  seed: string;
  field: { buddyStartX: number; windPerTick: number };
  throwsUsed: number;
  throwsPerMatch: number;
  yourScore: number;
};

export default function TournamentPage() {
  const { me, signedIn } = useSession();
  // Match lists are per-wallet, so there is nothing to ask for until there is a
  // session — and asking anyway would be a guaranteed 401 on every visit.
  const inbox = usePoll(
    () =>
      signedIn
        ? api.tournamentMine()
        : Promise.resolve({
            yourTurn: [],
            waiting: [],
            history: [],
            openChallenges: [],
            throwsPerMatch: 3,
          }),
    30000,
    [signedIn],
  );

  const [opponent, setOpponent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [result, setResult] = useState<any>(null);
  const [finished, setFinished] = useState<{
    yours: number;
    theirs: number | null;
    winner: string | null;
  } | null>(null);

  const openMatch = useCallback(async (challengeId: string) => {
    setError(null);
    try {
      const match = await api.tournamentMatch(challengeId);
      setFinished(null);
      setPlaying({
        challengeId,
        seed: match.seed,
        field: match.field,
        throwsUsed: match.yourThrows,
        throwsPerMatch: match.throwsPerMatch,
        yourScore: match.yourScore || 0,
      });
    } catch (caught: any) {
      setError(caught?.message || "Couldn't open that match.");
    }
  }, []);

  const create = useCallback(
    async (openChallenge: boolean) => {
      setError(null);
      try {
        const created = await api.tournamentCreate(openChallenge ? null : opponent.trim());
        setOpponent("");
        inbox.reload();
        void openMatch(created.challengeId);
      } catch (caught: any) {
        setError(caught?.message || "Couldn't create that challenge.");
      }
    },
    [opponent, inbox, openMatch],
  );

  const accept = useCallback(
    async (challengeId: string) => {
      try {
        await api.tournamentAccept(challengeId);
        inbox.reload();
        void openMatch(challengeId);
      } catch (caught: any) {
        setError(caught?.message || "Couldn't accept that challenge.");
      }
    },
    [inbox, openMatch],
  );

  const onThrow = useCallback(
    async (aim: Aim) => {
      if (!playing) return;
      sfx.throw();
      try {
        const thrown = await api.tournamentThrow(playing.challengeId, aim.angleQ, aim.powerQ);
        setResult(thrown);

        window.setTimeout(() => {
          if (thrown.grade === "perfect") sfx.perfect();
          else if (thrown.grade === "miss") sfx.miss();
          else sfx.good();
        }, (thrown.flight.flightTicks / 60) * 1000);

        window.setTimeout(
          () => {
            setResult(null);
            if (thrown.resolved) {
              setFinished({
                yours: thrown.yourScore,
                theirs: thrown.theirScore,
                winner: thrown.winner,
              });
              setPlaying(null);
              inbox.reload();
            } else if (thrown.nextField) {
              setPlaying((current) =>
                current
                  ? {
                      ...current,
                      throwsUsed: current.throwsUsed + 1,
                      yourScore: thrown.yourScore,
                      field: thrown.nextField!,
                    }
                  : current,
              );
            } else {
              // Your side is done; the match waits for the other player.
              setFinished({ yours: thrown.yourScore, theirs: null, winner: null });
              setPlaying(null);
              inbox.reload();
            }
          },
          (thrown.flight.flightTicks / 60) * 1000 + 1400,
        );
      } catch (caught: any) {
        setError(caught?.message || "That throw didn't land.");
      }
    },
    [playing, inbox],
  );

  const record = me ? `${me.profile.wins}–${me.profile.losses}` : "—";

  return (
    <GameShell
      game="tournament"
      title="Fetch Tournament"
      rules={
        <>
          <p>
            Challenge a wallet, or leave an open challenge for anyone to take. Both of you get three
            throws against <strong>the same seed</strong> — same wind, same field, same starting
            position. Pure skill.
          </p>
          <p>Nobody has to be online at once. The match settles when the second player finishes.</p>
          <p>
            150 points for a win, 60 for a draw, 25 for playing. Match throws don't touch your daily
            fetch allowance, and there is no Golden Bone in a match — the conditions have to be
            identical on both sides.
          </p>
        </>
      }
      hud={
        <>
          <HudItem label="record" value={record} />
          <HudItem label="your turn" value={inbox.data?.yourTurn.length ?? 0} tone="tone-warn" />
          <HudItem label="waiting" value={inbox.data?.waiting.length ?? 0} />
        </>
      }
    >
      <SignInPrompt reason="Sign in to challenge someone." />

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
        </div>
      )}

      {/* An active match takes over the page. */}
      {playing ? (
        <>
          <div className="banner">
            <span>
              Throw {playing.throwsUsed + 1} of {playing.throwsPerMatch} · your score{" "}
              <strong className="mono">{playing.yourScore}</strong>
            </span>
            <span className="label">same wind, same field — pure skill</span>
          </div>
          <FetchStage
            seed={playing.seed}
            throwIndex={playing.throwsUsed}
            field={playing.field}
            mode="normal"
            disabled={Boolean(result)}
            result={result}
            onThrow={onThrow}
          />
        </>
      ) : finished ? (
        <section className="card" style={{ textAlign: "center" }}>
          <BuddySprite
            pose={
              finished.winner === null
                ? "idle"
                : finished.winner === me?.wallet
                  ? "victory"
                  : finished.winner === "draw"
                    ? "idle"
                    : "defeat"
            }
            size={110}
          />
          <h2 className="serif" style={{ margin: "8px 0 4px" }}>
            {finished.winner === null
              ? "Your three are in"
              : finished.winner === "draw"
                ? "A draw"
                : finished.winner === me?.wallet
                  ? "You won"
                  : "They took it"}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {finished.theirs === null
              ? `You scored ${finished.yours}. Waiting on your opponent — you'll see the result here.`
              : `${finished.yours} to ${finished.theirs}.`}
          </p>
          <button className="btn" style={{ marginTop: 16 }} onClick={() => setFinished(null)}>
            back to matches
          </button>
        </section>
      ) : (
        <>
          <section className="card">
            <span className="label">start a match</span>
            <div className="row" style={{ marginTop: 10 }}>
              <input
                className="pill"
                style={{ flex: 1, minWidth: 200, textTransform: "none", letterSpacing: 0 }}
                value={opponent}
                onChange={(event) => setOpponent(event.target.value)}
                placeholder="opponent's wallet address"
                aria-label="Opponent wallet address"
                disabled={!signedIn}
              />
              <button
                className="btn btn-primary"
                onClick={() => void create(false)}
                disabled={!signedIn || opponent.trim().length < 32}
              >
                challenge
              </button>
              <button className="btn" onClick={() => void create(true)} disabled={!signedIn}>
                open challenge
              </button>
            </div>
            <p className="label" style={{ marginTop: 8 }}>
              an open challenge can be taken by anyone in the pack
            </p>
          </section>

          <MatchList
            title="your turn"
            matches={inbox.data?.yourTurn || []}
            emptyMessage="Nothing waiting on you."
            you={me?.wallet}
            action={(match) => (
              <button className="btn" onClick={() => void openMatch(match.challengeId)}>
                play
              </button>
            )}
          />

          <MatchList
            title="waiting on them"
            matches={inbox.data?.waiting || []}
            emptyMessage="No matches in flight."
            you={me?.wallet}
            action={(match) => (
              <span className="label">
                <CountdownClock until={match.expiresAtMs} prefix="expires in" />
              </span>
            )}
          />

          {(inbox.data?.openChallenges.length ?? 0) > 0 && (
            <MatchList
              title="open challenges"
              matches={inbox.data!.openChallenges}
              emptyMessage=""
              you={me?.wallet}
              action={(match) => (
                <button className="btn" onClick={() => void accept(match.challengeId)}>
                  take it
                </button>
              )}
            />
          )}

          <MatchList
            title="history"
            matches={inbox.data?.history || []}
            emptyMessage="No matches played yet."
            you={me?.wallet}
            action={(match) => (
              <span className={`label ${match.winner === me?.wallet ? "tone-good" : ""}`}>
                {match.winner === "draw"
                  ? "draw"
                  : match.winner === me?.wallet
                    ? "won"
                    : "lost"}{" "}
                {match.yourScore}–{match.theirScore ?? "?"}
              </span>
            )}
          />
        </>
      )}
    </GameShell>
  );
}

function MatchList({
  title,
  matches,
  emptyMessage,
  you,
  action,
}: {
  title: string;
  matches: Challenge[];
  emptyMessage: string;
  you?: string | null;
  action: (match: Challenge) => React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="spread">
        <span className="label">{title}</span>
        {title === "history" && <HiddenBone id="tournament-empty" />}
      </div>
      {!matches.length ? (
        emptyMessage ? (
          <p className="muted" style={{ marginBottom: 0, fontSize: 13.5 }}>
            {emptyMessage}
          </p>
        ) : null
      ) : (
        <table className="ledger" style={{ marginTop: 8 }}>
          <tbody>
            {matches.map((match) => (
              <tr key={match.challengeId}>
                <td>
                  {match.opponent ? (
                    <WalletChip address={match.opponent} />
                  ) : (
                    <span className="muted mono">open · anyone</span>
                  )}
                </td>
                <td className="muted mono" style={{ fontSize: 12 }}>
                  {shortAddress(match.challengeId, 6, 0)}
                </td>
                <td style={{ textAlign: "right" }}>{action(match)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
