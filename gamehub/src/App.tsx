/**
 * The hub shell and its route switch.
 *
 * Every game is lazily loaded, so the first paint is the header, the arcade and
 * the Solana vendor chunk — a visitor who came to pet the dog does not download
 * a canvas runner to do it.
 */
import React, { Suspense, lazy, useEffect } from "react";

import { HubHeader } from "./components/HubHeader";
import { EmptyState } from "./components/ui";
import { MAIN_SITE } from "./config";
import { useRoute } from "./router";

const HubHome = lazy(() => import("./features/home/HubHome"));
const PetPage = lazy(() => import("./features/pet/PetPage"));
const FetchPage = lazy(() => import("./features/fetch/FetchPage"));
const RunnerPage = lazy(() => import("./features/runner/RunnerPage"));
const RanksPage = lazy(() => import("./features/ranks/RanksPage"));
const HuntPage = lazy(() => import("./features/hunt/HuntPage"));
const TournamentPage = lazy(() => import("./features/tournament/TournamentPage"));
const PrizesPage = lazy(() => import("./features/prizes/PrizesPage"));
const ProfilePage = lazy(() => import("./features/profile/ProfilePage"));
const TricksPage = lazy(() => import("./features/tricks/TricksPage"));
const TrickPlayPage = lazy(() => import("./features/tricks/TrickPlayPage"));

const TITLES: Record<string, string> = {
  arcade: "Buddy Game Hub",
  fetch: "Daily Fetch · Buddy Game Hub",
  pet: "Pet the Dog · Buddy Game Hub",
  ranks: "Ranks · Buddy Game Hub",
  hunt: "Bone Hunt · Buddy Game Hub",
  runner: "Buddy vs. The Rugs · Buddy Game Hub",
  tournament: "Fetch Tournament · Buddy Game Hub",
  tricks: "New Tricks · Buddy Game Hub",
  trick: "New Tricks · Buddy Game Hub",
  prizes: "Prizes · Buddy Game Hub",
  profile: "Profile · Buddy Game Hub",
};

export default function App() {
  const route = useRoute();

  useEffect(() => {
    document.title = TITLES[route.tab] || TITLES.arcade;
    // A route change should land you at the top of the new page, but never
    // yank the view mid-game on a re-render.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.tab, route.param]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <HubHeader />

      <main id="main">
        <Suspense fallback={<EmptyState kind="loading" message="waking Buddy up" />}>
          {route.tab === "arcade" && <HubHome />}
          {route.tab === "pet" && <PetPage />}
          {route.tab === "fetch" && <FetchPage />}
          {route.tab === "runner" && <RunnerPage />}
          {route.tab === "ranks" && <RanksPage />}
          {route.tab === "hunt" && <HuntPage />}
          {route.tab === "tournament" && <TournamentPage />}
          {route.tab === "tricks" && <TricksPage />}
          {route.tab === "trick" && <TrickPlayPage trickId={route.param!} />}
          {route.tab === "prizes" && <PrizesPage />}
          {route.tab === "profile" && <ProfilePage address={route.param!} />}
        </Suspense>
      </main>

      <footer className="footer">
        <p>
          Points are kept off chain. Prizes are paid from the team's Squads vault on a cycle, by
          hand, and every payout links to the transaction that settled it — see{" "}
          <a href="/prizes">prizes</a>.
        </p>
        <p className="label">
          <a href={MAIN_SITE}>mybestbuddy.fun</a> · the games are for fun, not financial advice
        </p>
      </footer>
    </div>
  );
}
