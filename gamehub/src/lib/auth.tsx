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
  /** True once a wallet or a guest has a live hub session. */
  signedIn: boolean;
  signingIn: boolean;
  /** The session's player key: a wallet address, or `g:{hex}` for a guest. */
  playerId: string | null;
  isGuest: boolean;
  me: Me | null;
  error: string | null;
  /** Set when a session expired mid-session and needs one click to restore. */
  needsReauth: boolean;
  signIn: () => Promise<boolean>;
  signInAsGuest: () => Promise<boolean>;
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
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
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

  // Restore a session the SDK still holds after a reload. Guests come back
  // this way too — their continuity IS the SDK's persistence, since a guest
  // id is minted fresh and never re-derivable.
  useEffect(() => {
    if (!firebaseReady()) return undefined;
    return onIdTokenChanged(auth(), (user) => {
      if (!user) {
        setSignedIn(false);
        setPlayerId(null);
        setIsGuest(false);
        setMe(null);
        return;
      }
      // Cut at the first colon only: the uid is `{cluster}:{playerId}` and a
      // guest's player id (`g:{hex}`) itself contains a colon.
      const uid = String(user.uid);
      const tokenPlayer = uid.slice(uid.indexOf(":") + 1);
      const guest = tokenPlayer.startsWith("g:");
      signedInWallet.current = guest ? null : tokenPlayer;
      setPlayerId(tokenPlayer);
      setIsGuest(guest);
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
    if (!signedIn || !wallet || isGuest) return;
    if (signedInWallet.current && signedInWallet.current !== wallet) {
      void signOut(auth());
      setSignedIn(false);
      setMe(null);
      setNeedsReauth(true);
    }
  }, [wallet, signedIn, isGuest]);

  useEffect(() => {
    // A guest is permanently "disconnected" as far as the wallet adapter is
    // concerned; without the guard this effect would sign every guest out on
    // arrival.
    if (!connected && signedIn && !isGuest) {
      void signOut(auth());
      setSignedIn(false);
      setMe(null);
    }
  }, [connected, signedIn, isGuest]);

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

  /**
   * A session without a wallet: the server mints a fresh guest identity and
   * the same custom-token exchange signs it in. No prompt, no signature —
   * which is the entire point.
   */
  const signInAsGuest = useCallback(async () => {
    if (!firebaseReady()) {
      setError("The hub is not configured for sign-in yet.");
      return false;
    }
    setSigningIn(true);
    setError(null);
    try {
      const minted = await api.guestSession();
      await signInWithCustomToken(auth(), minted.token);
      setSignedIn(true);
      setNeedsReauth(false);
      setMe(await api.me());
      return true;
    } catch (caught: any) {
      setError(caught?.message || "Couldn't start a guest session. Try again.");
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutOfHub = useCallback(async () => {
    if (firebaseReady()) await signOut(auth());
    setSignedIn(false);
    setPlayerId(null);
    setIsGuest(false);
    setMe(null);
    setNeedsReauth(false);
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      wallet,
      signedIn,
      signingIn,
      playerId,
      isGuest,
      me,
      error,
      needsReauth,
      signIn,
      signInAsGuest,
      signOutOfHub,
      refresh,
    }),
    [wallet, signedIn, signingIn, playerId, isGuest, me, error, needsReauth, signIn, signInAsGuest, signOutOfHub, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
