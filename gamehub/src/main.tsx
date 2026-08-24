/**
 * Providers, then render.
 *
 * Same provider stack as the claim site — connection, wallet, wallet modal —
 * with the hub's session layered on top. Only Phantom and Solflare are
 * registered, matching the main app.
 */
import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";

import App from "./App";
import { SessionProvider } from "./lib/auth";
import { NamesProvider } from "./lib/names";
import { RPC_URL, TEST_WALLET_ENABLED } from "./config";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/arcade.css";
import "./vendor/wallet-adapter-ui.css";

function Root() {
  const wallets = useMemo(() => {
    const adapters: any[] = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
    return adapters;
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SessionProvider>
            <NamesProvider>
              <App />
            </NamesProvider>
          </SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

async function start() {
  // The end-to-end test wallet is imported only when the build was made with
  // the flag set, so Vite drops the module entirely from every other build.
  // Production deploys never set it, and CI greps the bundle to prove it.
  if (TEST_WALLET_ENABLED) {
    await import("./testWallet");
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void start();
