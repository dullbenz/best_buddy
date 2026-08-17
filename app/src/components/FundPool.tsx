import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import {
  COMMUNITY_STREAM_KINDS,
  ORIGINAL_SIGNER_DEADLINE,
  SEEDS,
  pda,
} from "../config";
import { countdown, fmtAmount, fmtDate, fmtSol } from "../format";
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
import { useAllMaturedLockups, useDistributor } from "../useDistributor";
import { useProgram } from "../useProgram";

/**
 * The crank.
 *
 * pump.fun's fee instructions are permissionless, so anyone can move creator
 * fees out of their vault, and our sync instructions are permissionless too.
 * Chained together that means any visitor can push the community's fees into
 * the staking pool with their own wallet. Nobody holds a key for it, and nobody
 * has to trust the team to run a bot.
 */
export function FundPool() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, untrackedSol, loading, error, refresh } = useDistributor();
  const {
    lockups: maturedLockups,
    loading: maturedLoading,
    refresh: refreshMatured,
  } = useAllMaturedLockups();

  const [pending, setPending] = useState<PendingFees | null>(null);
  const [communityStreams, setCommunityStreams] = useState<
    Array<{
      kind: number;
      label: string;
      period: string;
      total: bigint;
      released: bigint;
      start: number;
      end: number;
    }>
  >([]);
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
    try {
      // Swept-but-still-streaming forfeits, if any bucket has expired.
      const pdas = COMMUNITY_STREAM_KINDS.map((k) =>
        pda([SEEDS.communityStream, Buffer.from([k.kind])])
      );
      const infos = await connection.getMultipleAccountsInfo(pdas);
      const coder = (program?.account as any)?.communityStream?.coder.accounts;
      const found: typeof communityStreams = [];
      infos.forEach((info, i) => {
        if (!info || !coder) return;
        const d = coder.decode("communityStream", info.data);
        found.push({
          ...COMMUNITY_STREAM_KINDS[i],
          total: BigInt(d.total.toString()),
          released: BigInt(d.released.toString()),
          start: Number(d.start),
          end: Number(d.end),
        });
      });
      setCommunityStreams(found);
    } catch {
      setCommunityStreams([]);
    }
  }, [connection, program, config?.rewardMint?.toBase58()]);

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
          unreachable. Fees keep accruing at pump.fun regardless, so nothing is
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

  /** Mirror of CommunityStream::releasable, so the button can say the number. */
  function releasableNow(cs: (typeof communityStreams)[number]): bigint {
    const now = Math.floor(Date.now() / 1000);
    if (cs.total === 0n || now <= cs.start) return 0n;
    const vested =
      now >= cs.end
        ? cs.total
        : (cs.total * BigInt(now - cs.start)) / BigInt(cs.end - cs.start);
    return vested > cs.released ? vested - cs.released : 0n;
  }

  /**
   * The three expiry sweeps, as buttons.
   *
   * They were CLI-only, which quietly undercut the claim the page makes about
   * them: a rule that only the team can practically trigger is not a rule
   * anyone can enforce. The contract already gates on the clock and not the
   * caller, so the honest surface is a button that is dead until the deadline
   * and live for anybody afterwards.
   */
  async function runSweep(bucket: "old" | "influencer" | "signer") {
    if (!program || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const cfg = pda([SEEDS.config]);
      let sig: string;
      if (bucket === "old") {
        sig = await program.methods
          .sweepOldHolders()
          .accountsPartial({ cranker: publicKey, config: cfg, pool: pda([SEEDS.pool]) })
          .rpc();
      } else {
        const kind = bucket === "influencer" ? 0 : 1;
        const method =
          bucket === "influencer"
            ? program.methods.sweepInfluencers()
            : program.methods.sweepOriginalSigner();
        sig = await method
          .accountsPartial({
            cranker: publicKey,
            config: cfg,
            communityStream: pda([SEEDS.communityStream, Buffer.from([kind])]),
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }
      setStatus(`Swept. ${sig}`);
      refresh();
      load();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function releaseStream(kind: number) {
    if (!program || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const sig = await program.methods
        .releaseCommunityStream()
        .accountsPartial({
          cranker: publicKey,
          pool: pda([SEEDS.pool]),
          communityStream: pda([SEEDS.communityStream, Buffer.from([kind])]),
        })
        .rpc();
      setStatus(`Released. ${sig}`);
      refresh();
      load();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Flip matured lock-ups back to 1x weight, a batch per transaction.
   *
   * Same shape as the sweeps: the contract gates on the lock-up's clock, not
   * the caller, and nothing is paid to whoever clicks.
   */
  async function demoteMatured() {
    if (!program || !publicKey || maturedLockups.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      const cfg = pda([SEEDS.config]);
      const pool = pda([SEEDS.pool]);
      let done = 0;
      let lastSig = "";
      // ~8 demotes fit a transaction comfortably; more risks the size limit.
      for (let i = 0; i < maturedLockups.length; i += 8) {
        const tx = new Transaction();
        for (const l of maturedLockups.slice(i, i + 8)) {
          tx.add(
            await program.methods
              .demoteMatured()
              .accountsPartial({
                cranker: publicKey,
                config: cfg,
                pool,
                lockup: l.pubkey,
              })
              .instruction()
          );
          done += 1;
        }
        lastSig = await program.provider.sendAndConfirm!(tx);
      }
      setStatus(`Demoted ${done} lock-up${done === 1 ? "" : "s"}. ${lastSig}`);
      refresh();
      refreshMatured();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const sweeps: Array<{
    id: "old" | "influencer" | "signer";
    label: string;
    left: string | null;
    remaining: bigint;
    done: boolean;
    doneNote: string;
  }> = [
    {
      id: "old",
      label: "Legacy holder window",
      left: countdown(Number(config.oldHolderDeadline)),
      remaining:
        BigInt(config.oldHolderAllocation.toString()) -
        BigInt(config.oldHolderClaimed.toString()),
      done: !!config.oldHolderSwept,
      doneNote: "swept; the remainder went straight to stakers",
    },
    {
      id: "influencer",
      label: "Influencer window",
      left: countdown(Number(config.influencerDeadline)),
      remaining:
        BigInt(config.influencerAllocation.toString()) -
        BigInt(config.influencerClaimed.toString()),
      done: !!config.influencerSwept,
      doneNote: "swept; the remainder is streaming to stakers over 30 days",
    },
    {
      id: "signer",
      label: "2014 signer deadline",
      left: countdown(ORIGINAL_SIGNER_DEADLINE),
      remaining: BigInt(config.originalSignerAllocation.toString()),
      done: !!config.originalSignerSwept || !!config.originalSignerClaimed,
      doneNote: config.originalSignerClaimed
        ? "claimed by the signer; nothing to sweep"
        : "swept; streaming to stakers over 12 months",
    },
  ];

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

      // 2. Pay the frozen shareholder list; our vault is one of them.
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
      setStatus(`Done. ${sig}`);
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
          community's. They accrue automatically to addresses the contract
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
          <strong>That someone can be anybody, and that is the point.</strong>{" "}
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
              {pending ? `${fmtSol(pending.bondingCurve)} SOL` : "n/a"}
            </span>
            <span className="stat-label">Accrued at pump.fun</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {pending ? `${fmtSol(pending.amm)} SOL` : "n/a"}
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
            Connect a wallet to sign it. You pay only the network fee, a fraction
            of a cent, and none of the amounts below pass through your wallet.
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

        <div className="note">
          <strong>Exactly what you would be signing.</strong> One transaction,
          at most four instructions, skipping any with nothing to do:
          <ol>
            <li>
              Sweeps AMM-side fees back into the bonding-curve vault, if the
              coin has graduated (<code>transfer_creator_fees_to_pump_v2</code>).
            </li>
            <li>
              Pays out to the frozen shareholder list: 90% the community vault,
              10% the team's multisig (<code>distribute_creator_fees_v2</code>).
            </li>
            <li>
              Unwraps any wrapped SOL our vault received (
              <code>unwrap_wsol</code>). For a SOL-paired coin with this
              sharing config, pump.fun pays native lamports, so this step
              usually finds nothing to do. The button tolerates that and
              simply leaves it out.
            </li>
            <li>
              Credits it all to stakers (<code>sync_sol_rewards</code>).
            </li>
          </ol>
          <span className="muted">
            Steps 1 and 2 are pump.fun's own instructions, and their
            documentation states each is permissionless. Steps 3 and 4 are
            ours, and are open to anyone by design. If this interface ever
            breaks because pump.fun changed something, only this page needs
            replacing. The distributor contract does not reference them at all.
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Close an expired claim window</h2>
        <p className="muted">
          Each bucket has a deadline. Once it passes, whatever nobody claimed
          belongs to the stakers, but a Solana program cannot act on its own,
          so somebody has to say so. The contract checks the clock, never the
          caller: before the deadline these fail for everyone including us,
          and after it they work for anyone at all.
        </p>
        {sweeps.map((s) => (
          <div className="file-row" key={s.id}>
            <div className="file-meta">
              <span className="file-name">{s.label}</span>
              <span className="file-desc">
                {s.done
                  ? s.doneNote
                  : s.left
                    ? `${s.left} until the window closes`
                    : `${fmtAmount(s.remaining, true)} unclaimed, ready to move`}
              </span>
            </div>
            <div className="file-actions">
              {s.done ? (
                <span className="pill pill-done">done</span>
              ) : (
                <button
                  className={s.left ? "" : "primary"}
                  disabled={busy || !publicKey || !!s.left}
                  title={
                    s.left
                      ? "The claim window is still open"
                      : "Anyone can run this"
                  }
                  onClick={() => runSweep(s.id)}
                >
                  {s.left ? "Window still open" : "Sweep to the community"}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Demote matured lock-ups</h2>
        <p className="muted">
          A matured lock-up keeps its boosted weight until anyone flips it back
          to 1x, so every staker's share is diluted by absentees until someone
          presses this. The contract checks each lock-up's clock, never the
          caller, and pays the clicker nothing.
        </p>
        <div className="file-row">
          <div className="file-meta">
            <span className="file-name">Matured, still at boosted weight</span>
            <span className="file-desc">
              {maturedLoading
                ? "reading the chain…"
                : maturedLockups.length === 0
                  ? "none right now; every matured lock-up is already at 1x"
                  : `${maturedLockups.length} lock-up${
                      maturedLockups.length === 1 ? "" : "s"
                    } ready to demote, batched up to 8 per transaction`}
            </span>
          </div>
          <div className="file-actions">
            {maturedLockups.length === 0 ? (
              <span className="pill pill-done">all demoted</span>
            ) : (
              <button
                className="primary"
                disabled={busy || !publicKey}
                title="Anyone can run this"
                onClick={demoteMatured}
              >
                Demote {maturedLockups.length} lock-up
                {maturedLockups.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      </section>

      {communityStreams.length > 0 && (
        <section className="card">
          <h2>Forfeits streaming back to the community</h2>
          <p className="muted">
            When a streamed allocation expires unclaimed, it comes back to the
            stakers on the same schedule the claimant would have had: a
            forfeited 30-day stream returns over 30 days, the signer's year
            over a year. What has vested sits here until somebody credits it,
            and that somebody can be anyone.
          </p>
          {communityStreams.map((cs) => {
            const ready = releasableNow(cs);
            const done = cs.released >= cs.total && cs.total > 0n;
            return (
              <div className="file-row" key={cs.kind}>
                <div className="file-meta">
                  <span className="file-name">{cs.label}</span>
                  <span className="file-desc">
                    {fmtAmount(cs.released, true)} of {fmtAmount(cs.total, true)}{" "}
                    credited · runs until {fmtDate(cs.end)} ({cs.period} total)
                  </span>
                </div>
                <div className="file-actions">
                  {done ? (
                    <span className="pill pill-done">fully released</span>
                  ) : (
                    <button
                      className="primary"
                      disabled={busy || !publicKey || ready === 0n}
                      onClick={() => releaseStream(cs.kind)}
                    >
                      {ready > 0n
                        ? `Credit ${fmtAmount(ready, true)} to stakers`
                        : "Nothing vested yet"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {status && <div className="card status">{status}</div>}
    </div>
  );
}
