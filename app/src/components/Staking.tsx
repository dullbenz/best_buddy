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
import { countdown, fmtAmount, fmtSol } from "../format";
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
          ecosystem generates: pump.fun creator fees, donations, and everything
          forfeited by people who did not show up. Fees do not arrive by
          themselves; anyone can push them in from the Fund pool tab.
        </p>
        <h3 className="tiers-title">The locks you can choose from</h3>
        <TierCards selected={-1} onSelect={() => {}} />
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
      setStatus(`${label}. ${sig}`);
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
        <h2>Stake your tokens</h2>
        <p className="muted">
          Staking is how you earn from the community pool. Trading fees,
          donations and everything anyone forfeits are shared out among stakers
          in proportion to how much each has staked, and how long they locked
          it for. Holding tokens without staking earns nothing.
        </p>

        <div className="note">
          <strong>Two kinds of reward, and the difference matters.</strong>
          <br />
          <strong>Base</strong> is what your tokens earn at face value. It is
          yours to claim whenever you want, in every tier including Flexible.
          <br />
          <strong>Bonus</strong> (the <em>boost</em>) is the extra that a
          multiplier earns you. A 3.0× stake earns three times the share of the
          same tokens left flexible. The bonus is <em>held by the contract</em>{" "}
          until your lock matures, then paid in full.
          <br />
          <span className="muted">
            Why hold it back: otherwise you could take a 5× share, collect for a
            week, leave, and be paid for a commitment you never kept, at the
            expense of everyone who did keep theirs. Forfeited bonuses are not
            burned and do not come to us; they are shared among the stakers who
            stayed.
          </span>
        </div>

        <h3 className="tiers-title">Choose a lock</h3>
        <TierCards selected={tier} onSelect={setTier} />

        <p className="muted small">
          <strong>Is Flexible really a lockup?</strong> Partly, and it is fairer
          to say so than to hide behind the word "flexible". Leaving takes three
          days: you request to unstake, wait, then withdraw. So you cannot exit
          within the same day.
          <br />
          What makes it different from the locked tiers is that{" "}
          <strong>nothing is ever at risk and nothing is forfeited.</strong> You
          get 100% of your tokens and all your base rewards, always. Your stake
          keeps earning throughout the three days, the clock starts the moment
          you ask rather than the moment you staked, and once it elapses you can
          withdraw whenever suits you; there is no window to miss. Break a
          locked tier early and you lose the whole bonus plus 15% of your stake;
          Flexible has no equivalent, because there is nothing to break.
          <br />
          The delay exists so nobody can watch a large reward land, stake for a
          moment to capture a slice of it, and leave in the same block. Without
          it, everyone who actually stays would be diluted by people who were
          never really there.
        </p>

        <div className="form-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="Amount to stake"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !amount || parseFloat(amount) <= 0}
            onClick={stake}
          >
            Stake {TIERS[tier]?.name}
          </button>
        </div>
      </section>

      {position && (
        <section className="card">
          <h2>Your position</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{fmtAmount(position.amount, true)}</span>
              <span className="stat-label">Staked</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtAmount(position.claimableToken, true)}</span>
              <span className="stat-label">Base, claimable now</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtAmount(position.escrowToken, true)}</span>
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
              boost escrow plus 15% of principal, both of which go to the stakers
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
                Emergency exit (forfeit boost + 15%)
              </button>
            )}
          </div>
        </section>
      )}

      {status && <div className="card status">{status}</div>}
    </div>
  );
}

/**
 * The tiers as plans you pick between, not a spec table.
 *
 * Each card carries both halves of the trade (what you gain and what it costs),
 * because the cost is a real lockup with a real penalty, and burying that in
 * a footnote is how people end up surprised.
 */
function TierCards({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="tiers">
      {TIERS.map((t) => {
        const active = t.id === selected;
        return (
          <button
            key={t.id}
            type="button"
            className={active ? "tier tier-active" : "tier"}
            aria-pressed={active}
            onClick={() => onSelect(t.id)}
          >
            {t.popular && <span className="tier-flag">most rewarding</span>}

            <span className="tier-name">{t.name}</span>
            <span className="tier-mult">{t.multiplier}</span>
            <span className="tier-lock">{t.lock}</span>
            <span className="tier-tagline">{t.tagline}</span>

            <ul className="tier-perks">
              {t.perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>

            <ul className="tier-costs">
              {t.costs.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            <span className="tier-pick">{active ? "Selected" : "Select"}</span>
          </button>
        );
      })}
    </div>
  );
}
