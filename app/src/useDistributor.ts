import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { SEEDS, pda } from "./config";
import { useProgram } from "./useProgram";

export interface DistributorState {
  config: any;
  pool: any;
  vaultBalance: bigint;
  solVaultBalance: bigint;
  /**
   * Lamports the SOL vault must keep to stay rent-exempt. `sync_sol_rewards`
   * subtracts this before crediting anything, so the UI has to as well.
   * Otherwise the rent deposit reads as undistributed rewards forever.
   */
  solVaultRentFloor: bigint;
  /** Vault lamports the reward ledger has not booked yet. Never negative. */
  untrackedSol: bigint;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Live read of every public number the dashboard shows.
 *
 * Fetched once for the whole app rather than once per component. Seven of the
 * eight tabs want this same data, and each used to mount its own copy of the
 * hook and re-read the chain from scratch, so simply clicking through the
 * tabs cost around seventy RPC calls for numbers that never differed between
 * them, and the public devnet endpoint started answering 429.
 *
 * The reads are also batched. config, pool and the SOL vault are three
 * accounts fetched in one `getMultipleAccounts`, and the rent floor is a
 * constant for a given data length, so it is cached after the first look.
 * Three round trips for the whole session, against twelve per tab before.
 */
function useDistributorSource(): DistributorState {
  const program = useProgram();
  const { connection } = useConnection();
  const [config, setConfig] = useState<any>(null);
  const [pool, setPool] = useState<any>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [solVaultBalance, setSolVaultBalance] = useState<bigint>(0n);
  const [solVaultRentFloor, setSolVaultRentFloor] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const configPda = pda([SEEDS.config]);
        const poolPda = pda([SEEDS.pool]);
        const solVaultPda = pda([SEEDS.solVault]);

        // One round trip for three accounts, decoded locally. Anchor's
        // `.fetch()` is one request each and there is no reason to pay that
        // three times for accounts read together every time.
        const [cfgInfo, poolInfo, solInfo] = await connection.getMultipleAccountsInfo([
          configPda,
          poolPda,
          solVaultPda,
        ]);
        if (!cfgInfo) throw new Error("config account not found. Is the program initialized?");
        if (!poolInfo) throw new Error("stake pool account not found");

        const coder = (program.account as any).config.coder.accounts;
        const cfg = coder.decode("config", cfgInfo.data);
        const pl = coder.decode("stakePool", poolInfo.data);

        const vaultInfo = await connection.getTokenAccountBalance(pda([SEEDS.vault]));

        // Mirror the program: floor = rent for the vault's own data length.
        const floor = solInfo
          ? await rentFloorFor(connection, solInfo.data.length)
          : 0n;

        if (cancelled) return;
        setConfig(cfg);
        setPool(pl);
        setVaultBalance(BigInt(vaultInfo.value.amount));
        setSolVaultBalance(BigInt(solInfo?.lamports ?? 0));
        setSolVaultRentFloor(floor);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, connection, nonce]);

  // saturating_sub twice, exactly as sync_sol_rewards does on chain.
  const spendable =
    solVaultBalance > solVaultRentFloor ? solVaultBalance - solVaultRentFloor : 0n;
  const reserved = BigInt(pool?.reservedSol ?? 0);
  const untrackedSol = spendable > reserved ? spendable - reserved : 0n;

  return {
    config,
    pool,
    vaultBalance,
    solVaultBalance,
    solVaultRentFloor,
    untrackedSol,
    loading,
    error,
    refresh,
  };
}

/**
 * Rent for a given account size, cached.
 *
 * The rent rate is a chain constant that changes at most across epochs and
 * never in a way that matters to a page open for a few minutes, so asking the
 * RPC for the same data length on every read was pure waste.
 */
const rentCache = new Map<number, bigint>();
async function rentFloorFor(
  connection: { getMinimumBalanceForRentExemption: (n: number) => Promise<number> },
  dataLength: number
): Promise<bigint> {
  const hit = rentCache.get(dataLength);
  if (hit !== undefined) return hit;
  const value = BigInt(await connection.getMinimumBalanceForRentExemption(dataLength));
  rentCache.set(dataLength, value);
  return value;
}

const DistributorContext = createContext<DistributorState | null>(null);

/** Wrap the app once; every `useDistributor()` below shares this one read. */
export function DistributorProvider({ children }: { children: ReactNode }) {
  const value = useDistributorSource();
  return createElement(DistributorContext.Provider, { value }, children);
}

export function useDistributor(): DistributorState {
  const ctx = useContext(DistributorContext);
  if (!ctx) {
    throw new Error("useDistributor must be used inside <DistributorProvider>");
  }
  return ctx;
}

/**
 * Whether a read error means the account is genuinely absent, as opposed to a
 * transport failure.
 *
 * Anchor's `.fetch()` and `.all()` throw "Account does not exist ..." for a
 * missing account, but a 429 or a dropped connection throws something else
 * entirely. The two have to be told apart, because a refresh fired right after
 * a successful transaction is exactly when the public endpoint rate-limits, and
 * treating that 429 as "no account" would blank a live position, lock-up or
 * stream the moment it changed. Missing is normal and resets to empty; anything
 * else keeps whatever was already on screen.
 */
function isAccountMissing(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e).toLowerCase();
  return (
    msg.includes("account does not exist") ||
    msg.includes("could not find") ||
    msg.includes("not found")
  );
}

export interface StakeInfo {
  position: any | null;
  loading: boolean;
  refresh: () => void;
}

export function useStakePosition(owner: PublicKey | null): StakeInfo {
  const program = useProgram();
  const [position, setPosition] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program || !owner) {
      setPosition(null);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const acct = await (program.account as any).stakePosition.fetch(
          pda([SEEDS.stake, owner.toBuffer()])
        );
        if (!cancelled) setPosition(acct);
      } catch (e) {
        // No position yet is the normal case, not an error worth surfacing. A
        // transport error is different: keep the last good position rather than
        // blank it on a 429 right after staking.
        if (isAccountMissing(e)) {
          if (!cancelled) setPosition(null);
        } else {
          console.debug("useStakePosition: keeping last state after read error", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, owner?.toBase58(), nonce]);

  return { position, loading, refresh };
}

export interface LockupEntry {
  pubkey: PublicKey;
  account: any;
}

export interface LockupsInfo {
  lockups: LockupEntry[];
  loading: boolean;
  refresh: () => void;
}

/**
 * Every lock-up this wallet holds, each one a separate account with its own
 * amount, clock and escrow. `owner` is the first field after the 8-byte
 * discriminator, so the memcmp filter sits at offset 8.
 */
export function useLockups(owner: PublicKey | null): LockupsInfo {
  const program = useProgram();
  const [lockups, setLockups] = useState<LockupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program || !owner) {
      setLockups([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const all: Array<{ publicKey: PublicKey; account: any }> = await (
          program.account as any
        ).lockup.all([{ memcmp: { offset: 8, bytes: owner.toBase58() } }]);
        const sorted = all
          .map((l) => ({ pubkey: l.publicKey, account: l.account }))
          .sort((a, b) => Number(a.account.index) - Number(b.account.index));
        if (!cancelled) setLockups(sorted);
      } catch (e) {
        // No lock-ups is the normal case, not an error worth surfacing. A
        // transport error is different: keep the last good list rather than
        // blank it on a 429 right after locking.
        if (isAccountMissing(e)) {
          if (!cancelled) setLockups([]);
        } else {
          console.debug("useLockups: keeping last state after read error", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, owner?.toBase58(), nonce]);

  return { lockups, loading, refresh };
}

/**
 * Every lock-up, anyone's, that has matured but still carries its boosted
 * weight. Feeds the demote crank on the Fund pool tab, which is why it scans
 * all owners rather than one.
 */
export function useAllMaturedLockups(): LockupsInfo {
  const program = useProgram();
  const [lockups, setLockups] = useState<LockupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program) {
      setLockups([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const all: Array<{ publicKey: PublicKey; account: any }> = await (
          program.account as any
        ).lockup.all();
        const now = Math.floor(Date.now() / 1000);
        // Two minutes of slack against client/cluster clock skew. The demote
        // crank batches these into one atomic transaction, so a single lock-up
        // the cluster clock still considers premature reverts the whole batch
        // with EscrowNotMatured. Only count one as matured once it is clear of
        // that margin.
        const SKEW_MARGIN = 120;
        const due = all
          .filter(
            (l) => !l.account.demoted && Number(l.account.lockEnd) + SKEW_MARGIN <= now,
          )
          .map((l) => ({ pubkey: l.publicKey, account: l.account }));
        if (!cancelled) setLockups(due);
      } catch {
        if (!cancelled) setLockups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, nonce]);

  return { lockups, loading, refresh };
}

export function useStream(beneficiary: PublicKey | null) {
  const program = useProgram();
  const [stream, setStream] = useState<any>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program || !beneficiary) {
      setStream(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const acct = await (program.account as any).stream.fetch(
          pda([SEEDS.stream, beneficiary.toBuffer()])
        );
        if (!cancelled) setStream(acct);
      } catch (e) {
        // No stream is the normal case; a transport error keeps the last good
        // one rather than blanking it on a 429 right after a withdraw.
        if (isAccountMissing(e)) {
          if (!cancelled) setStream(null);
        } else {
          console.debug("useStream: keeping last state after read error", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, beneficiary?.toBase58(), nonce]);

  return { stream, refresh };
}

export interface ClaimReceipt {
  amount: bigint;
  claimedAt: number;
}

export interface ClaimReceipts {
  oldHolder: ClaimReceipt | null;
  influencer: ClaimReceipt | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Whether this wallet has already claimed, read from chain.
 *
 * The proof files say what a wallet is *owed*; they say nothing about whether
 * it has taken it. Without this the claim button stayed live and unchanged
 * after a successful claim, so the only way to find out it had worked was to
 * press it again and read the error, which is the worst possible way to learn
 * that your tokens already arrived.
 *
 * The contract records each claim in a receipt PDA and refuses a second one, so
 * the receipt existing *is* the answer. Both are one `getMultipleAccounts`.
 */
export function useClaimReceipts(owner: PublicKey | null): ClaimReceipts {
  const program = useProgram();
  const { connection } = useConnection();
  const [oldHolder, setOldHolder] = useState<ClaimReceipt | null>(null);
  const [influencer, setInfluencer] = useState<ClaimReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!program || !owner) {
      setOldHolder(null);
      setInfluencer(null);
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const infos = await connection.getMultipleAccountsInfo([
          pda([SEEDS.oldClaim, owner.toBuffer()]),
          pda([SEEDS.influencerClaim, owner.toBuffer()]),
        ]);
        const coder = (program.account as any).claimReceipt.coder.accounts;
        const read = (info: (typeof infos)[number]): ClaimReceipt | null => {
          if (!info) return null;
          const r = coder.decode("claimReceipt", info.data);
          return { amount: BigInt(r.amount.toString()), claimedAt: Number(r.claimedAt) };
        };
        if (cancelled) return;
        setOldHolder(read(infos[0]));
        setInfluencer(read(infos[1]));
      } catch {
        // A missing receipt is the normal case and is not an error; anything
        // else leaves the buttons live, which is the safe direction to fail.
        if (!cancelled) {
          setOldHolder(null);
          setInfluencer(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, connection, owner?.toBase58(), nonce]);

  return { oldHolder, influencer, loading, refresh };
}
