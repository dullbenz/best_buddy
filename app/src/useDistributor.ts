import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { SEEDS, pda } from "./config";
import { useProgram } from "./useProgram";

export interface DistributorState {
  config: any;
  pool: any;
  vaultBalance: bigint;
  solVaultBalance: bigint;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Live read of every public number the dashboard shows. */
export function useDistributor(): DistributorState {
  const program = useProgram();
  const { connection } = useConnection();
  const [config, setConfig] = useState<any>(null);
  const [pool, setPool] = useState<any>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [solVaultBalance, setSolVaultBalance] = useState<bigint>(0n);
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
        const [cfg, pl] = await Promise.all([
          (program.account as any).config.fetch(pda([SEEDS.config])),
          (program.account as any).stakePool.fetch(pda([SEEDS.pool])),
        ]);

        const vaultInfo = await connection.getTokenAccountBalance(pda([SEEDS.vault]));
        const solInfo = await connection.getAccountInfo(pda([SEEDS.solVault]));

        if (cancelled) return;
        setConfig(cfg);
        setPool(pl);
        setVaultBalance(BigInt(vaultInfo.value.amount));
        setSolVaultBalance(BigInt(solInfo?.lamports ?? 0));
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

  return { config, pool, vaultBalance, solVaultBalance, loading, error, refresh };
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
      } catch {
        // No position yet is the normal case, not an error worth surfacing.
        if (!cancelled) setPosition(null);
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
      } catch {
        if (!cancelled) setStream(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, beneficiary?.toBase58(), nonce]);

  return { stream, refresh };
}
