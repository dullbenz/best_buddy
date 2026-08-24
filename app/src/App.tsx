import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { CLUSTER, GAMEHUB_URL, IS_MAINNET } from "./config";
import { NAVIGATE_EVENT, type NavigateDetail } from "./nav";
import { onRouteChange, parseLocation, pushRoute, replaceRoute } from "./router";
import { Claims } from "./components/Claims";
import { SocialLinks } from "./components/SocialLinks";
import { Dashboard } from "./components/Dashboard";
import { Donate } from "./components/Donate";
import { FundPool } from "./components/FundPool";
import { HowItWorks } from "./components/HowItWorks";
import { Landing } from "./components/Landing";
import { MyBuddy } from "./components/MyBuddy";
import { Staking } from "./components/Staking";
import { Verify } from "./components/Verify";

type Tab =
  | "home"
  | "dashboard"
  | "claims"
  | "staking"
  | "fund pool"
  | "donate"
  | "verify"
  | "how it works"
  | "my buddy";

/**
 * The main nav row: the pages that describe the system, in reading order.
 *
 * "my buddy" is deliberately not here. It is the personal page, everything
 * one wallet can do, so it renders beside the wallet button it belongs to
 * rather than among pages that read the same for everyone.
 */
const NAV_TABS: Tab[] = [
  "home",
  "dashboard",
  "claims",
  "staking",
  "fund pool",
  "donate",
  "verify",
  "how it works",
];

/** Every routable tab, for the URL parser. */
const TABS: Tab[] = [...NAV_TABS, "my buddy"];

/**
 * Which chain this build talks to, but only when that is not mainnet.
 *
 * This replaced a full-width banner. The banner was honest but it cost a row
 * of vertical space on every screen and every tab, which meant staging never
 * looked like production and the spacing could not be judged. On mainnet this
 * renders nothing at all, so the header is byte-identical to what ships.
 */
function ClusterBadge() {
  if (IS_MAINNET) return null;
  return (
    <span
      className="cluster-badge"
      title={`Connected to ${CLUSTER}. Balances are not real, the tokens have no value, and explorer links point at ${CLUSTER}.`}
    >
      <span className="cluster-dot" aria-hidden="true" />
      {CLUSTER}
    </span>
  );
}

export function App() {
  const { connected } = useWallet();

  // Initial tab comes from the URL, so a deep link and a refresh both land
  // where they should instead of bouncing to the landing page.
  const [tab, setTabState] = useState<Tab>(() => parseLocation(TABS).tab as Tab);

  /**
   * Change tab and the address bar together.
   *
   * `fromPopstate` exists because the back button has already changed the URL
   * by the time we hear about it; pushing again there would append a new
   * entry and make Back a no-op that needs pressing twice.
   */
  const setTab = (next: Tab, section?: string) => {
    setTabState(next);
    pushRoute(next, section);
  };

  useEffect(() => {
    // Normalise whatever we landed on: an unknown path renders home, and the
    // URL should say so rather than keep showing a route that does not exist.
    // Checking the parsed tab would never fire: parseLocation has already
    // turned it into "home" by then, which is what `matched` is for.
    if (!parseLocation(TABS).matched) replaceRoute("home");
    return onRouteChange(() => setTabState(parseLocation(TABS).tab as Tab));
  }, []);

  /**
   * Cross-tab links, e.g. a claim on the Claims page pointing at the check on
   * Verify that settles it.
   *
   * Two steps, because the target does not exist when the event fires: the
   * listener records where to go, and a second effect scrolls once the new tab
   * has rendered. Deliberately not requestAnimationFrame: rAF is throttled to
   * a standstill in a background tab, so a link followed on an inactive tab
   * would change tabs and then just sit there.
   */
  // A ref, not state: clearing it must not re-render. Clearing state from
  // inside the effect below re-runs the effect, whose cleanup then cancels the
  // re-aim timers a few milliseconds after they are set, which is exactly the
  // bug this replaced. `navSeq` is what drives the effect, so following the
  // same link twice still works.
  const pendingAnchor = useRef<string | null>(null);
  const [navSeq, setNavSeq] = useState(0);

  const scrollBehavior = (): ScrollBehavior =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const { tab: next, anchor } = (event as CustomEvent<NavigateDetail>).detail;
      if (!TABS.includes(next as Tab)) return;
      setTab(next as Tab);
      pendingAnchor.current = anchor ?? null;
      setNavSeq((n) => n + 1);
      if (!anchor) window.scrollTo({ top: 0, behavior: scrollBehavior() });
    };
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, []);

  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    pendingAnchor.current = null;
    const el = document.getElementById(anchor);

    // Top of the page rather than staying put: landing on the right tab having
    // missed the card is a minor annoyance, whereas not moving reads as a dead
    // link.
    if (!el) {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      return;
    }

    const jump = () => el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    jump();

    // Verify's cards grow as their live checks resolve: the origin census and
    // the pump.fun fee config both land after first paint, and between them
    // they pushed the target most of a screen below where it had just been
    // scrolled to. So re-aim a few times while the page settles.
    //
    // Timers rather than a ResizeObserver: observers are delivered through the
    // rendering pipeline, which is throttled to nothing in a background tab,
    // exactly the case where someone follows a link and then switches away.
    // Timers still fire, and they also cover growth an observer on body would
    // miss, such as a late image inside a fixed-height box.
    let live = true;
    const ticks = [150, 600, 1500, 2800].map((ms) =>
      setTimeout(() => live && jump(), ms)
    );

    // Stop the moment the reader takes over, rather than yanking them back.
    const stop = () => {
      live = false;
      ticks.forEach(clearTimeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);

    return stop;
  }, [navSeq]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          {/* Decorative: the h1 beside it already names the project, so
              announcing the logo too would just repeat it to a screen reader. */}
          {/* The dog's head, not the full badge: at 44px the two-figure scene
              is unreadable, and the wordmark beside it already says "Buddy". */}
          <img className="brand-mark" src="/mark-192.png" alt="" width="44" height="44" />
          <div className="brand-text">
            <h1>Buddy</h1>
            {/* The marks sit on the tagline's own line, not beside the whole
                brand block, so they align to the text baseline rather than
                floating against the full height of the logo. */}
            <div className="brand-sub">
              <span className="tagline">community-owned, on-chain, verifiable</span>
              <SocialLinks />
            </div>
          </div>
        </div>

        <div className="header-right">
          <ClusterBadge />
          {/* Leftmost of the controls: it leaves the site, so it should not sit
              between the wallet button and the page that button belongs to.
              Mirrors the "← main site" pill in the hub's own header, so the two
              read as one round trip rather than two unrelated links. */}
          <a
            className="hub-btn hub-btn-play"
            href={GAMEHUB_URL}
            title="Play fetch, pet the dog, and earn a rank"
          >
            Game hub ↗
          </a>
          {/* The personal page sits beside the wallet button because they are
              about the same thing: this button is where "your wallet" lives on
              screen. Rendered only while connected; the page itself still
              answers a cold deep link with a connect prompt. */}
          {connected && (
            <button
              type="button"
              className={tab === "my buddy" ? "hub-btn active" : "hub-btn"}
              onClick={() => setTab("my buddy")}
            >
              My Buddy
            </button>
          )}
          <WalletMultiButton />
        </div>
      </header>

      <nav>
        {NAV_TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === "home" && (
          <Landing go={(t, section) => setTab(t as Tab, section)} />
        )}
        {tab === "dashboard" && <Dashboard />}
        {tab === "claims" && <Claims />}
        {tab === "staking" && <Staking />}
        {tab === "fund pool" && <FundPool />}
        {tab === "donate" && <Donate />}
        {tab === "verify" && <Verify />}
        {tab === "how it works" && <HowItWorks />}
        {tab === "my buddy" && <MyBuddy />}
      </main>

      <footer>
        <p className="muted small">
          This interface only reads and writes on-chain state. Allocations,
          deadlines and rules are fixed in the program and cannot be changed by
          the team. Nothing here is investment advice or a promise of any
          financial outcome.
        </p>
      </footer>
    </div>
  );
}
