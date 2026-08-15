import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { PROGRAM_ID } from "./config";

const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export interface UpgradeAuthorityState {
  /** True once we have confirmed the program can never be changed again. */
  immutable: boolean | null;
  /** Base58 authority, or null when immutable / not yet loaded. */
  authority: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Read who — if anyone — can still replace this program's code.
 *
 * This is the most important single fact about any Solana contract, and the one
 * most projects never surface. A frozen config only governs what the program's
 * own instructions permit; whoever holds the upgrade authority can deploy
 * different instructions entirely.
 *
 * The upgradeable loader stores it in a ProgramData account derived from the
 * program id. Layout: 4-byte enum discriminant, 8-byte slot, then a 1-byte
 * Option tag — 0 means None, which is what immutable looks like — followed by
 * the 32-byte authority when the tag is 1.
 */
function useUpgradeAuthoritySource(): UpgradeAuthorityState {
  const { connection } = useConnection();
  const [state, setState] = useState<UpgradeAuthorityState>({
    immutable: null,
    authority: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [programData] = PublicKey.findProgramAddressSync(
          [PROGRAM_ID.toBuffer()],
          BPF_UPGRADEABLE_LOADER
        );
        const info = await connection.getAccountInfo(programData);
        if (cancelled) return;

        if (!info) {
          // No ProgramData account at all means the program was deployed with a
          // non-upgradeable loader — also immutable, just by a different route.
          setState({ immutable: true, authority: null, loading: false, error: null });
          return;
        }

        const hasAuthority = info.data[12] === 1;
        setState({
          immutable: !hasAuthority,
          authority: hasAuthority
            ? new PublicKey(info.data.subarray(13, 45)).toBase58()
            : null,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        if (!cancelled) {
          setState({
            immutable: null,
            authority: null,
            loading: false,
            error: e?.message ?? String(e),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection]);

  return state;
}

const UpgradeAuthorityContext = createContext<UpgradeAuthorityState | null>(null);

/**
 * Shared, for the same reason the distributor read is: the Landing and Verify
 * tabs both want this, it is one account, and it cannot change while a page is
 * open — a program upgrade would not reach an already-loaded tab anyway.
 */
export function UpgradeAuthorityProvider({ children }: { children: ReactNode }) {
  const value = useUpgradeAuthoritySource();
  return createElement(UpgradeAuthorityContext.Provider, { value }, children);
}

export function useUpgradeAuthority(): UpgradeAuthorityState {
  const ctx = useContext(UpgradeAuthorityContext);
  if (!ctx) {
    throw new Error(
      "useUpgradeAuthority must be used inside <UpgradeAuthorityProvider>"
    );
  }
  return ctx;
}
