/**
 * The community shelf: tricks made by players, for players.
 *
 * Everything here is data from the API — the shelf is the one part of the hub
 * whose games are documents, not deploys. Guests browse freely and can play
 * with one click; nothing on this page needs a wallet.
 */
import React from "react";

import { GameShell } from "../../components/GameShell";
import { SignInPrompt } from "../../components/HubHeader";
import { EmptyState, WalletChip } from "../../components/ui";
import { api, type TrickShelf, type TrickSummary } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { usePoll } from "../../lib/poll";
import { navigate } from "../../router";
import { TrickStats } from "./common";

function TrickCard({ trick, featured = false }: { trick: TrickSummary; featured?: boolean }) {
  return (
    <div className="card" style={featured ? { borderColor: "var(--accent, #e8a33d)" } : undefined}>
      {featured && <span className="chip">game of the week</span>}
      <h3 className="serif" style={{ margin: "6px 0 2px", fontSize: 20 }}>
        {trick.title}
      </h3>
      <TrickStats summary={trick} />
      {trick.intro && (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          {trick.intro}
        </p>
      )}
      <div className="spread" style={{ marginTop: 12, alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>
          by <WalletChip address={trick.payoutWallet} />
        </span>
        <button className="btn btn-primary" onClick={() => navigate("trick", trick.trickId)}>
          play
        </button>
      </div>
    </div>
  );
}

export default function TricksPage() {
  const { signedIn } = useSession();
  const shelf = usePoll<TrickShelf>(() => api.tricks(), 60000, [signedIn]);

  const featured = shelf.data?.featured?.trick || null;
  const rest = (shelf.data?.tricks || []).filter(
    (trick) => trick.trickId !== featured?.trickId,
  );

  return (
    <GameShell
      game="tricks"
      title="New Tricks"
      rules={
        <>
          <p>The community teaches Buddy new tricks — quizzes, word scrambles, emoji riddles.</p>
          <p>
            Play one attempt per trick per day; answering fast earns bonus points. Rate what you
            finish — the best-rated trick each week becomes the <strong>Game of the Week</strong>,
            and its creator wins a prize from the weekly cycle.
          </p>
          <p className="muted">
            No wallet needed: play and create as a guest. A wallet session additionally earns Good
            Boy Points, capped per day.
          </p>
        </>
      }
    >
      <SignInPrompt
        reason="Sign in or play as a guest to take on the community's tricks."
        allowGuest
      />

      {shelf.error && <EmptyState message="The shelf is unreachable right now." />}
      {!shelf.error && !shelf.data && <EmptyState kind="loading" message="opening the workshop" />}

      {featured && (
        <div style={{ marginBottom: 16 }}>
          <TrickCard trick={featured} featured />
        </div>
      )}

      {shelf.data && !featured && !rest.length && (
        <EmptyState message="Nothing on the shelf yet. The first trick is still being taught." />
      )}

      {rest.length > 0 && (
        <div className="game-grid" style={{ marginTop: featured ? 0 : 4 }}>
          {rest.map((trick) => (
            <TrickCard key={trick.trickId} trick={trick} />
          ))}
        </div>
      )}

      {/* Authoring lands here next: the submission form replaces this note. */}
      <p className="label" style={{ marginTop: 18 }}>
        want to teach Buddy one of your own? trick submissions open right here soon.
      </p>
    </GameShell>
  );
}
