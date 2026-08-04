import { BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { useState } from "react";
import { SEEDS, TIERS, TOKEN_DECIMALS, pda } from "../config";
import { countdown, fmtSol, fmtTokens } from "../format";
import { useDistributor, useStakePosition } from "../useDistributor";
import { useProgram } from "../useProgram";

export function Staking() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, refresh: refreshPool } = useDistributor();
  const { position, refresh: refreshPosition } = useStakePosition(publicKey ?? null);

  const [amount, setAmount] = useState("");
  const [tier, setTier] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!publicKey) {
    return (
      <div className="card">
        <h2>Staking</h2>
        <p className="muted">
          Connect a wallet to stake. Staking registers you for every reward the
          ecosystem generates — routed creator fees, donations, and everything
          forfeited by people who did not show up.
        </p>
        <TierTable />
      </div>
    );
  }
  if (!config) return <div className="card">Loading…</div>;

  const refresh = () => {
    refreshPool();
    refreshPosition();
  };

  async function ensureAta(): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(config.rewardMint, publicKey!);
    const info = await connection.getAccountInfo(ata);
    if (!info) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(publicKey!, ata, publicKey!, config.rewardMint)
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
    }
    return ata;
  }

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      const sig = await fn();
      setStatus(`${label} — ${sig}`);
      refresh();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const commonAccounts = async () => ({
    owner: publicKey!,
    config: pda([SEEDS.config]),
    pool: pda([SEEDS.pool]),
    position: pda([SEEDS.stake, publicKey!.toBuffer()]),
    vault: pda([SEEDS.vault]),
    solVault: pda([SEEDS.solVault]),
    destination: await ensureAta(),
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const stake = () =>
    run("Staked", async () => {
      const raw = BigInt(Math.round(parseFloat(amount) * 10 ** TOKEN_DECIMALS));
      const source = await ensureAta();
      return program!.methods
        .stake(new BN(raw.toString()), tier)
        .accountsPartial({
          owner: publicKey!,
          config: pda([SEEDS.config]),
          pool: pda([SEEDS.pool]),
          position: pda([SEEDS.stake, publicKey!.toBuffer()]),
          vault: pda([SEEDS.vault]),
          source,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

  const claimRewards = () =>
    run("Rewards claimed", async () =>
      program!.methods.claimRewards().accountsPartial(await commonAccounts()).rpc()
    );

  const withdrawEscrow = () =>
    run("Boost escrow released", async () =>
      program!.methods.withdrawBoostEscrow().accountsPartial(await commonAccounts()).rpc()
    );

  const requestUnstake = () =>
    run("Cooldown started", async () =>
      program!.methods
        .requestUnstake()
        .accountsPartial({
          owner: publicKey!,
          position: pda([SEEDS.stake, publicKey!.toBuffer()]),
        })
        .rpc()
    );

  const unstake = () =>
    run("Unstaked", async () =>
      program!.methods
        .unstake(new BN(position.amount.toString()))
        .accountsPartial(await commonAccounts())
        .rpc()
    );

  const emergencyExit = () =>
    run("Exited early", async () =>
      program!.methods.emergencyExit().accountsPartial(await commonAccounts()).rpc()
    );

  const now = Date.now() / 1000;
  const lockLeft = position ? countdown(Number(position.lockEnd), now) : null;

  return (
    <div className="stack">
      <section className="card">
        <h2>Stake</h2>
        <p className="muted">
          Base rewards are claimable at any time, in every tier. The boost — the
          extra your multiplier earns — is held until your lock matures, and is
          forfeited if you leave early.
        </p>
        <div className="form-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.multiplier}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={busy || !amount || parseFloat(amount) <= 0}
            onClick={stake}
          >
            Stake
          </button>
        </div>
        <TierTable />
      </section>

      {position && (
        <section className="card">
          <h2>Your position</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{fmtTokens(position.amount)}</span>
              <span className="stat-label">Staked</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtTokens(position.claimableToken)}</span>
              <span className="stat-label">Base, claimable now</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtTokens(position.escrowToken)}</span>
              <span className="stat-label">Boost, held to maturity</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtSol(position.claimableSol)} SOL</span>
              <span className="stat-label">SOL rewards</span>
            </div>
          </div>
          {lockLeft && (
            <p className="muted small">
              Lock matures in {lockLeft}. Leaving before then forfeits the entire
              boost escrow plus 10% of principal, both of which go to the stakers
              who stay.
            </p>
          )}
          <div className="button-row">
            <button disabled={busy} onClick={claimRewards}>
              Claim base rewards
            </button>
            <button disabled={busy || !!lockLeft} onClick={withdrawEscrow}>
              Release boost escrow
            </button>
            <button disabled={busy} onClick={requestUnstake}>
              Start cooldown
            </button>
            <button disabled={busy} onClick={unstake}>
              Unstake all
            </button>
            {lockLeft && (
              <button className="danger" disabled={busy} onClick={emergencyExit}>
                Emergency exit (forfeit boost + 10%)
              </button>
            )}
          </div>
        </section>
      )}

      {status && <div className="card status">{status}</div>}
    </div>
  );
}

function TierTable() {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Multiplier</th>
            <th>Lock</th>
            <th>Boost escrow</th>
          </tr>
        </thead>
        <tbody>
          {TIERS.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.multiplier}</td>
              <td>{t.lock}</td>
              <td>{t.id === 0 ? "none" : "released at maturity"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
