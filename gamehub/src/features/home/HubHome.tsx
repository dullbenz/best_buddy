/**
 * The arcade.
 *
 * Six doors, your standing, and what the pack is doing right now. The job of
 * this page is to make it obvious what there is to do and that other people are
 * already doing it.
 */
import React from "react";

import {
  ArtFetch,
  ArtHunt,
  ArtPet,
  ArtRanks,
  ArtRunner,
  ArtTournament,
} from "../../components/GameArt";
import {
  BoneGlyph,
  CountdownClock,
  EmptyState,
  RankBadge,
  RankProgress,
  StreakFlame,
  WalletChip,
} from "../../components/ui";
import { SignInPrompt } from "../../components/HubHeader";
import { HiddenBone } from "../hunt/hiddenBones";
import { api, type Summary } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { useFeed, usePetTotal } from "../../lib/live";
import { commas } from "../../lib/format";
import { usePoll } from "../../lib/poll";
import { navigate, type Tab } from "../../router";
import { RANKS } from "../../config";

type GameCard = {
  tab: Tab;
  name: string;
  hook: string;
  stat: (summary: Summary | null, petTotal: number | null) => string;
  art: React.ReactNode;
};

const GAMES: GameCard[] = [
  {
    tab: "pet",
    name: "Pet the Dog",
    hook: "One Buddy. Everyone's hands. Tap him.",
    stat: (_summary, petTotal) => (petTotal === null ? "…" : `${commas(petTotal)} pets and counting`),
    art: <ArtPet />,
  },
  {
    tab: "fetch",
    name: "Daily Fetch",
    hook: "Three throws a day. Land it just past his reach.",
    stat: () => "streaks multiply everything",
    art: <ArtFetch />,
  },
  {
    tab: "runner",
    name: "Buddy vs. The Rugs",
    hook: "Jump the rugs. Duck the broken charts. Keep going.",
    stat: () => "weekly tournament",
    art: <ArtRunner />,
  },
  {
    tab: "hunt",
    name: "Bone Hunt",
    hook: "Bones are buried across the hub. The clues are in the lore.",
    stat: () => "first finders take the most",
    art: <ArtHunt />,
  },
  {
    tab: "tournament",
    name: "Fetch Tournament",
    hook: "Challenge a wallet. Same wind, same field, pure skill.",
    stat: () => "head to head",
    art: <ArtTournament />,
  },
  {
    tab: "ranks",
    name: "Best Boy",
    hook: "Every point you earn moves you up the ladder.",
    stat: () => "Stray → Immortal Dog",
    art: <ArtRanks />,
  },
];

export default function HubHome() {
  const { me, signedIn } = useSession();
  const { total: petTotal } = usePetTotal();
  const feed = useFeed(8);
  const summary = usePoll<Summary>(() => api.summary(), 30000);
  const prizes = usePoll(() => api.prizes(), 120000);

  const nextCycleEnd = nextWeeklyBoundary();

  return (
    <div className="stack">
      <a
        className="prize-banner"
        href="/prizes"
        onClick={(event) => {
          event.preventDefault();
          navigate("prizes");
        }}
      >
        <span className="label">weekly prize cycle</span>
        <strong className="mono">
          <CountdownClock until={nextCycleEnd} prefix="ends in" urgentUnderMs={24 * 3600 * 1000} />
        </strong>
        <span className="muted" style={{ fontSize: 13 }}>
          paid from the Squads vault · every payout links to its transaction
        </span>
        <span className="label" style={{ marginLeft: "auto" }}>
          receipts →
        </span>
      </a>

      {/* Your standing, or an invitation to have one. */}
      <section className="card">
        {signedIn && me ? (
          <div className="stack" style={{ gap: 12 }}>
            <div className="spread">
              <div className="row">
                <RankBadge rank={me.profile.rank} size="lg" />
                <span className="muted mono" style={{ fontSize: 13 }}>
                  {commas(me.profile.gbp)} good boy points
                </span>
              </div>
              <StreakFlame days={me.profile.streakDays} />
            </div>
            <RankProgress gbp={me.profile.gbp} />
            <div className="row" style={{ gap: 18 }}>
              <span className="label">pets {commas(me.profile.petCount)}</span>
              <span className="label">
                fetch {commas(me.profile.sources?.fetch || 0)}
              </span>
              <span className="label">
                runner best {commas(me.profile.runnerBest)}
              </span>
              <span className="label">
                w/l {me.profile.wins}–{me.profile.losses}
              </span>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="spread">
              <div>
                <span className="label">the ladder</span>
                <h2 className="serif" style={{ margin: "4px 0 0" }}>
                  Everyone starts a Stray
                </h2>
              </div>
              <HiddenBone id="home-rank-card" />
            </div>
            <div className="row" style={{ gap: 6, opacity: 0.45 }}>
              {RANKS.map((rank) => (
                <RankBadge key={rank.key} rank={rank.key} />
              ))}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Play anything you like as a guest. Sign in and it starts counting — points, rank, and a
              place on the weekly boards.
            </p>
            <SignInPrompt reason="Every game is playable right now." />
          </div>
        )}
      </section>

      <div className="game-grid">
        {GAMES.map((game) => (
          <a
            key={game.tab}
            className="game-card"
            href={`/${game.tab}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(game.tab);
            }}
          >
            <div className="game-card-art">{game.art}</div>
            <h3>{game.name}</h3>
            <p>{game.hook}</p>
            <span className="game-card-stat">{game.stat(summary.data, petTotal)}</span>
          </a>
        ))}
      </div>

      <section className="card" aria-live="polite">
        <div className="spread">
          <span className="label">the pack, just now</span>
          <HiddenBone id="home-feed" />
        </div>
        {feed.length === 0 ? (
          <EmptyState message="Nobody has played yet today. Somebody has to be first." />
        ) : (
          <ul className="feed" style={{ marginTop: 10 }}>
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

      {prizes.data && prizes.data.paid.length > 0 && (
        <section className="card">
          <span className="label">last payout</span>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="serif" style={{ fontSize: 18 }}>
              {prizes.data.paid[0].cycle}
            </span>
            <span className="mono tone-warn">
              {commas(prizes.data.paid[0].totalBuddy)} $BUDDY to {prizes.data.paid[0].winners.length}{" "}
              winners
            </span>
            <a
              href="/prizes"
              onClick={(event) => {
                event.preventDefault();
                navigate("prizes");
              }}
              className="label"
            >
              see the receipts →
            </a>
          </div>
        </section>
      )}
    </div>
  );
}

/** Monday 00:05 UTC, when the weekly job seals the boards. */
function nextWeeklyBoundary(): number {
  const now = new Date();
  const dayOfWeek = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (7 - dayOfWeek), 0, 5, 0, 0),
  );
  return monday.getTime();
}
