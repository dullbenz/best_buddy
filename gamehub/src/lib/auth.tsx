/**
 * Sign-in-with-Solana session.
 *
 * Connecting a wallet and signing in are two different things, deliberately.
 * Connecting is free and instant; signing in costs one signature prompt and is
 * only asked for at the moment it buys something — recording a score, entering
 * a match. Guests can play everything.
 *
 * The signature is over a server-issued message carrying a single-use nonce,
 * an expiry and the cluster, so it is not replayable. It moves no funds and
 * costs no fee, and the sign-in sheet says so.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signInWithCustomToken, signOut, onIdTokenChanged } from "firebase/auth";
import bs58 from "bs58";

import { api, setTokenProvider, setUnauthorizedHandler, type Me } from "./api";
import { auth, firebaseReady } from "./firebase";

type SessionState = {
  /** The connected wallet, whether or not it has signed in. */
  wallet: string | null;
  /** True once a wallet has a live hub session. */
  signedIn: boolean;
  signingIn: boolean;
  me: Me | null;
  error: string | null;
  /** Set when a session expired mid-session and needs one click to restore. */
  needsReauth: boolean;
  signIn: () => Promise<boolean>;
  signOutOfHub: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState>(null as any);
export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const wallet = publicKey ? publicKey.toBase58() : null;

  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  const signedInWallet = useRef<string | null>(null);
  const hadSession = useRef(false);

  // The API asks for a fresh ID token per request; the SDK refreshes it for us.
  useEffect(() => {
    setTokenProvider(async () => {
      if (!firebaseReady()) return null;
      const user = auth().currentUser;
      return user ? user.getIdToken() : null;
    });
    setUnauthorizedHandler(() => {
      // Only a session that existed can expire. Pages poll signed-in endpoints
      // while logged out and get a perfectly ordinary 401 back; telling a
      // first-time visitor their sign-in expired would be both wrong and
      // baffling.
      if (!hadSession.current) return;
      setSignedIn(false);
      setNeedsReauth(true);
    });
  }, []);

  useEffect(() => {
    if (signedIn) hadSession.current = true;
  }, [signedIn]);

  // Restore a session the SDK still holds after a reload.
  useEffect(() => {
    if (!firebaseReady()) return undefined;
    return onIdTokenChanged(auth(), (user) => {
      if (!user) {
        setSignedIn(false);
        setMe(null);
        return;
      }
      const [, tokenWallet] = String(user.uid).split(":");
      signedInWallet.current = tokenWallet;
      setSignedIn(true);
      setNeedsReauth(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      setMe(await api.me());
    } catch {
      // A failed refresh is not worth interrupting a game for.
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Switching accounts in the wallet must not leave the previous account's
   * session attached — the next score would be recorded to the wrong wallet.
   */
  useEffect(() => {
    if (!signedIn || !wallet) return;
    if (signedInWallet.current && signedInWallet.current !== wallet) {
      void signOut(auth());
      setSignedIn(false);
      setMe(null);
      setNeedsReauth(true);
    }
  }, [wallet, signedIn]);

  useEffect(() => {
    if (!connected && signedIn) {
      void signOut(auth());
      setSignedIn(false);
      setMe(null);
    }
  }, [connected, signedIn]);

  const signIn = useCallback(async () => {
    if (!wallet || !signMessage) {
      setError("Connect a wallet that can sign messages.");
      return false;
    }
    if (!firebaseReady()) {
      setError("The hub is not configured for sign-in yet.");
      return false;
    }

    setSigningIn(true);
    setError(null);
    try {
      const challenge = await api.challenge(wallet);
      const signature = await signMessage(new TextEncoder().encode(challenge.message));
      const verified = await api.verify(wallet, challenge.nonce, bs58.encode(signature));
      await signInWithCustomToken(auth(), verified.token);
      signedInWallet.current = wallet;
      setSignedIn(true);
      setNeedsReauth(false);
      setMe(await api.me());
      return true;
    } catch (caught: any) {
      // A user declining the signature prompt is a choice, not an error worth
      // shouting about.
      const declined =
        caught?.name === "WalletSignMessageError" || /reject|denied|cancel/i.test(caught?.message || "");
      setError(declined ? null : caught?.message || "Sign-in failed. Try again.");
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [wallet, signMessage]);

  const signOutOfHub = useCallback(async () => {
    if (firebaseReady()) await signOut(auth());
    setSignedIn(false);
    setMe(null);
    setNeedsReauth(false);
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      wallet,
      signedIn,
      signingIn,
      me,
      error,
      needsReauth,
      signIn,
      signOutOfHub,
      refresh,
    }),
    [wallet, signedIn, signingIn, me, error, needsReauth, signIn, signOutOfHub, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
