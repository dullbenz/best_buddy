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
  /**
   * Whether the program account exists at all. Before launch day it does not,
   * and that state must never be conflated with immutability: a missing
   * program has no authority to burn, and reporting it as "none — nobody can
   * change the contract" would be the site making its strongest promise about
   * a program that is not there yet.
   */
  deployed: boolean | null;
  loading: boolean;
  error: string | null;
}

/**
 * Read who, if anyone, can still replace this program's code.
 *
 * This is the most important single fact about any Solana contract, and the one
 * most projects never surface. A frozen config only governs what the program's
 * own instructions permit; whoever holds the upgrade authority can deploy
 * different instructions entirely.
 *
 * The upgradeable loader stores it in a ProgramData account derived from the
 * program id. Layout: 4-byte enum discriminant, 8-byte slot, then a 1-byte
 * Option tag (0 means None, which is what immutable looks like), followed by
 * the 32-byte authority when the tag is 1.
 */
function useUpgradeAuthoritySource(): UpgradeAuthorityState {
  const { connection } = useConnection();
  const [state, setState] = useState<UpgradeAuthorityState>({
    immutable: null,
    authority: null,
    deployed: null,
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
        // Both accounts in one read. The program account has to be checked
        // first: a missing ProgramData account only implies a non-upgradeable
        // loader when the program itself exists. Before launch neither account
        // exists, and that state is "not deployed", never "immutable".
        const [programInfo, dataInfo] = await connection.getMultipleAccountsInfo([
          PROGRAM_ID,
          programData,
        ]);
        if (cancelled) return;

        if (!programInfo) {
          setState({
            immutable: null,
            authority: null,
            deployed: false,
            loading: false,
            error: null,
          });
          return;
        }

        if (!dataInfo) {
          // Program exists but has no ProgramData account: deployed with a
          // non-upgradeable loader, immutable by a different route.
          setState({
            immutable: true,
            authority: null,
            deployed: true,
            loading: false,
            error: null,
          });
          return;
        }

        const hasAuthority = dataInfo.data[12] === 1;
        setState({
          immutable: !hasAuthority,
          authority: hasAuthority
            ? new PublicKey(dataInfo.data.subarray(13, 45)).toBase58()
            : null,
          deployed: true,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        if (!cancelled) {
          setState({
            immutable: null,
            authority: null,
            deployed: null,
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
 * open, since a program upgrade would not reach an already-loaded tab anyway.
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
