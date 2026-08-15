import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { enforceCanonicalHost } from "./canonicalHost";
import { RPC_URL } from "./config";
import { DistributorProvider } from "./useDistributor";
import { UpgradeAuthorityProvider } from "./useUpgradeAuthority";
import "./vendor/wallet-adapter-ui.css";
import "./styles.css";

function Root() {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {/* Both providers read the chain once for the whole app. Inside the
              wallet providers because the Anchor client is built from the
              connected wallet, and above App so switching tabs re-renders
              rather than re-fetching. */}
          <DistributorProvider>
            <UpgradeAuthorityProvider>
              <App />
            </UpgradeAuthorityProvider>
          </DistributorProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// Bounce Firebase's default domains before anything renders.
enforceCanonicalHost();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
