/**
 * Header and tab rule.
 *
 * Same 32px pill family and squared index-rule tabs as the claim site, so the
 * two properties read as one project. The "main site" pill is deliberately
 * prominent: the hub is an annex, and people arriving here should always be one
 * click from the thing it is an annex to.
 */
import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { CLUSTER, IS_MAINNET, MAIN_SITE } from "../config";
import { TABS, navigate, useRoute, type Tab } from "../router";
import { useSession } from "../lib/auth";
import { RankBadge } from "./ui";

export function HubHeader() {
  const route = useRoute();
  const { me, signedIn } = useSession();

  return (
    <header>
      <div className="hub-header">
        <a
          className="hub-brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("arcade");
          }}
        >
          <img className="hub-mark" src="/mark-192.png" alt="" width={40} height={40} />
          <span>
            <h1 className="hub-title">Buddy</h1>
            <span className="hub-tagline">game hub</span>
          </span>
        </a>

        {!IS_MAINNET && (
          <span className="pill cluster-badge" title="This hub is running against devnet">
            {CLUSTER}
          </span>
        )}

        {signedIn && me && me.profile && me.wallet && (
          <a
            className="pill"
            href={`/wallet/${me.wallet}`}
            onClick={(event) => {
              event.preventDefault();
              navigate("profile", me.wallet!);
            }}
            style={{ padding: "0 8px 0 4px" }}
          >
            <RankBadge rank={me.profile.rank} />
          </a>
        )}

        {signedIn && me?.guest && (
          // Guests earn no rank, so this pill is their whole header presence —
          // and the readiness signal the e2e suite waits on.
          <span className="pill" data-testid="guest-badge">
            guest
          </span>
        )}

        <a className="hub-btn" href={MAIN_SITE}>
          ← main site
        </a>

        <WalletMultiButton />
      </div>

      <nav className="tabs" aria-label="Games">
        {TABS.map((tab) => (
          <button
            key={tab}
            className="tab"
            aria-current={route.tab === tab ? "page" : undefined}
            onClick={() => navigate(tab as Tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
    </header>
  );
}

/**
 * The one prompt that asks for a signature, shown only where it buys something.
 *
 * Guests can play every game; this appears at the moment a score would be
 * recorded, which is the moment the ask makes sense.
 */
export function SignInPrompt({ reason, allowGuest = false }: { reason: string; allowGuest?: boolean }) {
  const { wallet, signedIn, signingIn, signIn, signInAsGuest, error, needsReauth } = useSession();

  if (signedIn && !needsReauth) return null;

  return (
    <div className={`banner ${error ? "banner-bad" : ""}`}>
      <span>
        {error
          ? error
          : needsReauth
            ? "Your sign-in expired."
            : wallet
              ? reason
              : allowGuest
                ? `${reason} Connect a wallet — or just play as a guest.`
                : `${reason} Connect a wallet to start.`}
      </span>
      {wallet && (
        <button className="btn" onClick={() => void signIn()} disabled={signingIn}>
          {signingIn ? "check your wallet…" : needsReauth ? "sign in again" : "sign in"}
        </button>
      )}
      {allowGuest && !needsReauth && (
        <button className="btn" onClick={() => void signInAsGuest()} disabled={signingIn}>
          play as a guest
        </button>
      )}
    </div>
  );
}
