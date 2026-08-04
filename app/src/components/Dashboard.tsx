import { ORIGINAL_SIGNER_DEADLINE } from "../config";
import { countdown, fmtDate, fmtSol, fmtTokens } from "../format";
import { useDistributor } from "../useDistributor";

/**
 * The public transparency view.
 *
 * Everything here is read straight from chain and needs no wallet. It is the
 * answer to "why should we trust you this time" — every bucket, every
 * deadline, every forfeiture, visible to anyone who loads the page.
 */
export function Dashboard() {
  const { config, pool, vaultBalance, solVaultBalance, loading, error } = useDistributor();

  if (loading) return <div className="card">Loading on-chain state…</div>;
  if (error)
    return (
      <div className="card error">
        Could not read the distributor: {error}
        <div className="muted small">
          The program may not be deployed yet, or the RPC endpoint is unreachable.
        </div>
      </div>
    );
  if (!config || !pool) return null;

  const now = Date.now() / 1000;
  const oldRemaining = BigInt(config.oldHolderAllocation) - BigInt(config.oldHolderClaimed);
  const infRemaining = BigInt(config.influencerAllocation) - BigInt(config.influencerClaimed);
  const oldLeft = countdown(Number(config.oldHolderDeadline), now);
  const infLeft = countdown(Number(config.influencerDeadline), now);
  const signerLeft = countdown(ORIGINAL_SIGNER_DEADLINE, now);

  const stakedPct =
    Number(vaultBalance) > 0
      ? ((Number(pool.totalStaked) / Number(vaultBalance)) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="stack">
      <section className="card highlight">
        <h2>The 2030 clock</h2>
        <p className="muted">
          Reserved for whoever holds the key that signed the original 2014 Bitcoin
          message. Provable on-chain, claimable by nobody else. If it is never
          claimed, it becomes community staking rewards.
        </p>
        <div className="bigstat">
          <span className="value">{signerLeft ?? "expired"}</span>
          <span className="label">
            {config.originalSignerClaimed
              ? "CLAIMED — the original Buddy came back"
              : `remaining · deadline ${fmtDate(ORIGINAL_SIGNER_DEADLINE)}`}
          </span>
        </div>
        <div className="stat-row">
          <Stat label="Allocation" value={fmtTokens(config.originalSignerAllocation, true)} />
          <Stat
            label="Status"
            value={
              config.originalSignerSwept
                ? "returned to community"
                : config.originalSignerClaimed
                ? "claimed, streaming"
                : "unclaimed"
            }
          />
        </div>
      </section>

      <section className="card">
        <h2>Bucket 1 — community staking pool</h2>
        <p className="muted">
          Fed by pump.fun creator fees, donations, and every forfeiture in the
          system. Nothing arrives on its own — fees have to be pushed in, and
          anyone can do it from the Fund pool tab. Grows forever; never starts
          full.
        </p>
        <div className="stat-row">
          <Stat label="Lifetime token rewards" value={fmtTokens(pool.lifetimeTokenRewards, true)} />
          <Stat label="Lifetime SOL rewards" value={`${fmtSol(pool.lifetimeSolRewards)} SOL`} />
          <Stat label="Total staked" value={fmtTokens(pool.totalStaked, true)} />
          <Stat label="Share of vault staked" value={`${stakedPct}%`} />
        </div>
        {BigInt(pool.pendingTokenRewards) > 0n && (
          <p className="muted small">
            {fmtTokens(pool.pendingTokenRewards)} tokens are buffered awaiting the
            next distribution (they arrived while nothing was staked).
          </p>
        )}
      </section>

      <section className="card">
        <h2>Bucket 2 — old Buddy holders</h2>
        <p className="muted">
          Restitution for everyone holding the original token at the snapshot.
          Paid instantly, yours to do anything with.
        </p>
        <div className="stat-row">
          <Stat label="Allocation" value={fmtTokens(config.oldHolderAllocation, true)} />
          <Stat label="Claimed" value={fmtTokens(config.oldHolderClaimed, true)} />
          <Stat label="Unclaimed" value={fmtTokens(oldRemaining, true)} />
          <Stat
            label={oldLeft ? "Closes in" : "Window"}
            value={oldLeft ?? (config.oldHolderSwept ? "swept" : "closed")}
          />
        </div>
        <Progress
          done={Number(config.oldHolderClaimed)}
          total={Number(config.oldHolderAllocation)}
        />
      </section>

      <section className="card">
        <h2>Bucket 3 — influencers</h2>
        <p className="muted">
          72 hours to claim; claiming opens a 30-day stream. Whatever is not
          claimed goes to the stakers.
        </p>
        <div className="stat-row">
          <Stat label="Allocation" value={fmtTokens(config.influencerAllocation, true)} />
          <Stat label="Claimed" value={fmtTokens(config.influencerClaimed, true)} />
          <Stat label="Forfeited so far" value={config.influencerSwept ? fmtTokens(infRemaining, true) : "—"} />
          <Stat
            label={infLeft ? "Closes in" : "Window"}
            value={infLeft ?? (config.influencerSwept ? "swept" : "closed")}
          />
        </div>
        <Progress
          done={Number(config.influencerClaimed)}
          total={Number(config.influencerAllocation)}
        />
      </section>

      <section className="card">
        <h2>Bucket 4b — the new dev</h2>
        <p className="muted">
          Streams over 12 months behind a cliff. The dev wallet holds nothing
          after deployment; this contract is the only path to those tokens.
        </p>
        <div className="stat-row">
          <Stat label="Allocation" value={fmtTokens(config.devAllocation, true)} />
          <Stat label="Stream created" value={config.devStreamCreated ? "yes" : "not yet"} />
        </div>
      </section>

      <section className="card">
        <h2>Custody</h2>
        <div className="stat-row">
          <Stat label="Token vault" value={fmtTokens(vaultBalance, true)} />
          <Stat label="SOL vault" value={`${fmtSol(solVaultBalance)} SOL`} />
          <Stat
            label="Of which not yet credited"
            value={`${fmtSol(
              solVaultBalance > BigInt(pool.reservedSol)
                ? solVaultBalance - BigInt(pool.reservedSol)
                : 0n
            )} SOL`}
          />
          <Stat label="Config" value={config.locked ? "LOCKED" : "unlocked"} />
        </div>
        <p className="muted small">
          Locked means allocations, Merkle roots, deadlines and the signer key can
          no longer be changed by anyone, including the authority.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
