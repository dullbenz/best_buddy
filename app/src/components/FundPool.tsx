import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { SEEDS, pda } from "../config";
import { fmtSol } from "../format";
import {
  NATIVE_MINT,
  PendingFees,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  distributeCreatorFeesIx,
  readPendingFees,
  transferCreatorFeesToPumpIx,
  sharingConfigPda,
} from "../pumpfun";
import { useDistributor } from "../useDistributor";
import { useProgram } from "../useProgram";

/**
 * The crank.
 *
 * pump.fun's fee instructions are permissionless, so anyone can move creator
 * fees out of their vault — and our sync instructions are permissionless too.
 * Chained together that means any visitor can push the community's fees into
 * the staking pool with their own wallet. Nobody holds a key for it, and nobody
 * has to trust the team to run a bot.
 */
export function FundPool() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, untrackedSol, loading, error, refresh } = useDistributor();

  const [pending, setPending] = useState<PendingFees | null>(null);
  const [wsolBalance, setWsolBalance] = useState<bigint>(0n);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const solVault = pda([SEEDS.solVault]);

  const load = useCallback(async () => {
    if (!config) return;
    try {
      setPending(await readPendingFees(connection, config.rewardMint));
    } catch {
      setPending(null);
    }
    try {
      // Fees may also be sitting as wrapped SOL owned by our vault.
      const ata = associatedTokenAddress(solVault, NATIVE_MINT);
      const info = await connection.getAccountInfo(ata);
      setWsolBalance(
        info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n
      );
    } catch {
      setWsolBalance(0n);
    }
  }, [connection, config?.rewardMint?.toBase58()]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="card">Loading on-chain state…</div>;
  if (error || !config)
    return (
      <div className="card error">
        Could not read the distributor{error ? `: ${error}` : ""}
        <div className="muted small">
          The program may not be deployed yet, or the RPC endpoint is
          unreachable. Fees keep accruing at pump.fun regardless — nothing is
          lost, it just cannot be moved from this page until the connection
          works.
        </div>
      </div>
    );

  const somethingToDo =
    (pending?.bondingCurve ?? 0n) > 0n ||
    (pending?.amm ?? 0n) > 0n ||
    wsolBalance > 0n ||
    untrackedSol > 0n;

  async function run() {
    if (!program || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const tx = new Transaction();
      const mint: PublicKey = config.rewardMint;

      // 1. If the coin has graduated, sweep AMM fees back to the curve vault.
      if ((pending?.amm ?? 0n) > 0n) {
        tx.add(transferCreatorFeesToPumpIx(publicKey, sharingConfigPda(mint)));
      }

      // 2. Pay the frozen shareholder list — our vault is one of them.
      if ((pending?.bondingCurve ?? 0n) > 0n || (pending?.amm ?? 0n) > 0n) {
        tx.add(distributeCreatorFeesIx(publicKey, mint, [solVault, config.devWallet]));
      }

      // 3. If any arrived as wrapped SOL, turn it into lamports.
      if (wsolBalance > 0n) {
        tx.add(
          await program.methods
            .unwrapWsol()
            .accountsPartial({
              config: pda([SEEDS.config]),
              pool: pda([SEEDS.pool]),
              solVault,
              wsolAccount: associatedTokenAddress(solVault, NATIVE_MINT),
              tokenProgram: TOKEN_PROGRAM_ID,
              rent: SYSVAR_RENT_PUBKEY,
            })
            .instruction()
        );
      }

      // 4. Book whatever is now sitting in the vault as staker rewards.
      tx.add(
        await program.methods
          .syncSolRewards()
          .accountsPartial({
            config: pda([SEEDS.config]),
            pool: pda([SEEDS.pool]),
            solVault,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .instruction()
      );

      const sig = await program.provider.sendAndConfirm!(tx);
      setStatus(`Done — ${sig}`);
      refresh();
      load();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card highlight">
        <h2>Credit the community pool</h2>
        <p className="muted">
          Every trade on this token pays a fee, and those fees are already the
          community's — they accrue automatically to addresses the contract
          controls, and no wallet, including ours, can withdraw them anywhere
          else. That part needs nobody's help.
        </p>
        <p className="muted">
          The last step is a bookkeeping one. A Solana program cannot notice a
          balance changing; it only runs when a transaction calls it. So the
          fees sit in the vault, safe but not yet counted, until someone signs
          the transaction that credits them to the stakers.
        </p>
        <p className="muted small">
          <strong>That someone can be anybody — and that is the point.</strong>{" "}
          The instruction takes no admin key and pays whoever is staked, never
          whoever clicked. So the community never has to wait on us, and we
          could not divert or delay a single lamport if we tried. Press the
          button below and you have just done the team's job for them.
        </p>
      </section>

      <section className="card">
        <h2>Fees accrued, awaiting credit</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-value">
              {pending ? `${fmtSol(pending.bondingCurve)} SOL` : "—"}
            </span>
            <span className="stat-label">Accrued at pump.fun</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {pending ? `${fmtSol(pending.amm)} SOL` : "—"}
            </span>
            <span className="stat-label">Accrued at pump.fun (AMM)</span>
          </div>
          <div className="stat">
            <span className="stat-value">{fmtSol(wsolBalance)} SOL</span>
            <span className="stat-label">In the vault, as wrapped SOL</span>
          </div>
          <div className="stat">
            <span className="stat-value">{fmtSol(untrackedSol)} SOL</span>
            <span className="stat-label">In the vault, not yet credited</span>
          </div>
        </div>

        {!publicKey ? (
          <p className="muted small">
            Connect a wallet to sign it. You pay only the network fee — a fraction
            of a cent — and none of the amounts below pass through your wallet.
          </p>
        ) : (
          <div className="button-row">
            <button className="primary" disabled={busy || !somethingToDo} onClick={run}>
              {somethingToDo
                ? "Credit these fees to the stakers"
                : "Everything is already credited"}
            </button>
            <button disabled={busy} onClick={load}>
              Refresh
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Exactly what you would be signing</h2>
        <ol className="muted small">
          <li>
            Sweeps AMM-side fees back into the bonding-curve vault, if the coin
            has graduated (<code>transfer_creator_fees_to_pump_v2</code>).
          </li>
          <li>
            Pays out to the frozen shareholder list — 90% the community vault,
            10% the Token Creator (<code>distribute_creator_fees_v2</code>).
          </li>
          <li>
            Unwraps any wrapped SOL our vault received (<code>unwrap_wsol</code>).
          </li>
          <li>
            Credits it to stakers (<code>sync_sol_rewards</code>).
          </li>
        </ol>
        <p className="muted small">
          Steps 1 and 2 are pump.fun's own instructions, and their documentation
          states each is permissionless. Steps 3 and 4 are ours, and are open to
          anyone by design. If this interface ever breaks because pump.fun
          changed something, only this page needs replacing — the distributor
          contract does not reference them at all.
        </p>
      </section>

      {status && <div className="card status">{status}</div>}
    </div>
  );
}
