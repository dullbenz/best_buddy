import { useState } from "react";
import {
  ORIGINAL_MESSAGE,
  ORIGINAL_SIGNER_DEADLINE,
  btcAddressUrl,
  btcTxUrl,
} from "../config";
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
  const { config, pool, vaultBalance, solVaultBalance, untrackedSol, loading, error } =
    useDistributor();

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


  return (
    <div className="stack">
      <section className="card highlight">
        <h2>Bucket 4 — the two founders</h2>

        <div className="split">
          <div className="split-half">
            <div className="split-head">
              <h3>The original 2014 signer</h3>
              <span className="badge">
                {config.originalSignerSwept
                  ? "returned to community"
                  : config.originalSignerClaimed
                  ? "claimed"
                  : "unclaimed"}
              </span>
            </div>

            <div className="bigstat">
              <span className="value">{signerLeft ?? "expired"}</span>
              <span className="label">
                {config.originalSignerClaimed
                  ? "CLAIMED — the original Buddy came back"
                  : `remaining · deadline ${fmtDate(ORIGINAL_SIGNER_DEADLINE)}`}
              </span>
            </div>

            <p className="muted small">
              {fmtTokens(config.originalSignerAllocation, true)} tokens, waiting
              for whoever holds the Bitcoin key that signed the 2014 message
              this coin is named after. They prove it by signing — no
              permission, no paperwork, nothing we can veto. Unclaimed by 2030,
              it becomes staking rewards.
            </p>

            <Provenance signerPubkey={config.originalSignerPubkey} />
          </div>

          <div className="split-half">
            <div className="split-head">
              <h3>The Token Creator</h3>
              <span className="badge">
                {config.devStreamCreated ? "streaming" : "not started"}
              </span>
            </div>

            <div className="bigstat">
              <span className="value">{fmtTokens(config.devAllocation, true)}</span>
              <span className="label">over 12 months, behind a cliff</span>
            </div>

            <p className="muted small">
              Nothing is held in a wallet. The tokens sit in this contract and
              are released a little at a time, with none at all before the
              cliff. There is no instruction that pays them out faster — not for
              the Token Creator, not for anyone.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Bucket 1 — community staking pool</h2>
        <p className="muted">
          Trading fees, donations and every forfeiture in the system end up
          here. <strong>Stake your tokens to earn a share of it</strong> — the
          pool is split between stakers in proportion to what they lock, so
          holding alone earns nothing.
        </p>

        <div className="stat-row">
          <Stat label="In the pool" value={`${fmtSol(solVaultBalance)} SOL`} />
          <Stat
            label="Waiting to be credited"
            value={`${fmtSol(untrackedSol)} SOL`}
            emphasis={untrackedSol > 0n}
          />
          <Stat label="Total staked" value={fmtTokens(pool.totalStaked, true)} />
          <Stat label="Paid out to date" value={`${fmtSol(pool.lifetimeSolRewards)} SOL`} />
        </div>

        <div className="note">
          <strong>Why money can sit here uncredited.</strong> Anything sent to
          the vault is safe, but the contract cannot notice it by itself — a
          Solana program only runs when a transaction calls it. So funds arrive,
          and stay uncounted until somebody signs the transaction that credits
          them to stakers.
          <br />
          <strong>That somebody can be anyone.</strong> The instruction takes no
          admin key and pays whoever is staked, not whoever clicks. We cannot do
          it faster than you can, and we cannot stop you doing it.
          {untrackedSol > 0n ? (
            <div className="note-cta">
              {fmtSol(untrackedSol)} SOL is uncredited right now — the{" "}
              <strong>Fund pool</strong> tab hands it to the stakers.
            </div>
          ) : null}
        </div>

        {BigInt(pool.pendingTokenRewards) > 0n && (
          <p className="muted small">
            {fmtTokens(pool.pendingTokenRewards)} tokens are buffered until
            somebody stakes — they arrived while the pool was empty, and are
            held rather than lost.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Bucket 2 — Legacy Buddy holders</h2>
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
        <h2>What the contract is holding</h2>
        <p className="muted">
          Every token above is already inside this contract — not in a treasury
          wallet, not with the team. These are the two accounts it holds them
          in, and whether the rules governing them can still be edited.
        </p>
        <div className="stat-row">
          <Stat label="Tokens held" value={fmtTokens(vaultBalance, true)} />
          <Stat label="SOL held" value={`${fmtSol(solVaultBalance)} SOL`} />
          <Stat
            label="Rules"
            value={config.locked ? "LOCKED" : "still editable"}
            emphasis={!config.locked}
          />
        </div>
        <p className="muted small">
          <strong>Tokens held</strong> is every unclaimed allocation — the claim
          windows, the streams and the staking pool all pay out of it, so it
          falls as people claim. <strong>SOL held</strong> is fee and donation
          revenue for the stakers.{" "}
          {config.locked ? (
            <>
              <strong>LOCKED</strong> means the allocations, the Merkle lists of
              who can claim, the deadlines and the 2014 key are now fixed. Nobody
              can change them — not the team, not the wallet that deployed this.
              That is enforced by the program, and you can verify it on the{" "}
              <strong>Verify</strong> tab.
            </>
          ) : (
            <>
              <strong>Still editable</strong> means the deploying wallet can
              currently change allocations, claim lists, deadlines and the 2014
              key. That power is destroyed at launch by locking the config —
              until then, treat these numbers as provisional.
            </>
          )}
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "stat stat-emphasis" : "stat"}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function hex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/**
 * The 2014 evidence, laid out so a stranger can check it in about a minute.
 *
 * Only the last row is what the contract actually enforces — the on-chain
 * public key. The Bitcoin address, message and transaction are here so you can
 * confirm that key belongs to that 2014 transaction. Anything we have not
 * published yet says so, rather than showing a plausible-looking blank.
 */
function Provenance({ signerPubkey }: { signerPubkey: number[] | Uint8Array }) {
  const { address, message, txid } = ORIGINAL_MESSAGE;
  const key = hex(signerPubkey);
  const empty = key.replace(/0/g, "") === "";

  return (
    <div className="provenance">
      <div className="provenance-head">What has to be proved</div>

      <div className="prov-row">
        <span className="prov-label">Signing address</span>
        {address ? (
          <>
            <a
              className="mono prov-value"
              href={btcAddressUrl(address)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {address}
            </a>
            <Copy text={address} />
          </>
        ) : (
          <span className="prov-value muted">published before launch</span>
        )}
      </div>

      <div className="prov-row">
        <span className="prov-label">Message</span>
        {message ? (
          <>
            <code className="prov-value prov-message">{message}</code>
            <Copy text={message} />
          </>
        ) : (
          <span className="prov-value muted">published before launch</span>
        )}
      </div>

      <div className="prov-row">
        <span className="prov-label">2014 transaction</span>
        {txid ? (
          <a
            className="mono prov-value"
            href={btcTxUrl(txid)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {txid.slice(0, 16)}… ↗ view on mempool.space
          </a>
        ) : (
          <span className="prov-value muted">published before launch</span>
        )}
      </div>

      <div className="prov-row">
        <span className="prov-label">Key the contract checks</span>
        {empty ? (
          <span className="prov-value muted">not set on chain yet</span>
        ) : (
          <>
            <span className="mono prov-value">
              {key.slice(0, 16)}…{key.slice(-8)}
            </span>
            <Copy text={key} />
          </>
        )}
      </div>

      <p className="prov-foot">
        The bottom row is the only one the program enforces, and the config lock
        freezes it. The rows above let you confirm it is the same key that signed
        in 2014 — check them against the Bitcoin blockchain, not against us.
      </p>
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
