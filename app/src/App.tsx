import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState } from "react";
import { Claims } from "./components/Claims";
import { Dashboard } from "./components/Dashboard";
import { Staking } from "./components/Staking";

type Tab = "dashboard" | "claims" | "staking";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Buddy</h1>
          <span className="tagline">community-owned, on-chain, verifiable</span>
        </div>
        <WalletMultiButton />
      </header>

      <nav>
        {(["dashboard", "claims", "staking"] as Tab[]).map((t) => (
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
        {tab === "dashboard" && <Dashboard />}
        {tab === "claims" && <Claims />}
        {tab === "staking" && <Staking />}
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
