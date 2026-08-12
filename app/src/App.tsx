import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState } from "react";
import { CLUSTER, IS_MAINNET } from "./config";
import { Claims } from "./components/Claims";
import { SocialLinks } from "./components/SocialLinks";
import { Dashboard } from "./components/Dashboard";
import { FundPool } from "./components/FundPool";
import { HowItWorks } from "./components/HowItWorks";
import { Landing } from "./components/Landing";
import { Staking } from "./components/Staking";
import { Verify } from "./components/Verify";

type Tab =
  | "home"
  | "dashboard"
  | "claims"
  | "staking"
  | "fund pool"
  | "verify"
  | "how it works";

const TABS: Tab[] = [
  "home",
  "dashboard",
  "claims",
  "staking",
  "fund pool",
  "verify",
  "how it works",
];

/**
 * Which chain this build talks to — but only when that is not mainnet.
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
  const [tab, setTab] = useState<Tab>("home");

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
                brand block — so they align to the text baseline rather than
                floating against the full height of the logo. */}
            <div className="brand-sub">
              <span className="tagline">community-owned, on-chain, verifiable</span>
              <SocialLinks />
            </div>
          </div>
        </div>

        <div className="header-right">
          <ClusterBadge />
          <WalletMultiButton />
        </div>
      </header>

      <nav>
        {TABS.map((t) => (
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
        {tab === "home" && <Landing go={(t) => setTab(t as Tab)} />}
        {tab === "dashboard" && <Dashboard />}
        {tab === "claims" && <Claims />}
        {tab === "staking" && <Staking />}
        {tab === "fund pool" && <FundPool />}
        {tab === "verify" && <Verify />}
        {tab === "how it works" && <HowItWorks />}
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
