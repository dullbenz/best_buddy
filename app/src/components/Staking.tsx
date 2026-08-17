import { useWallet } from "@solana/wallet-adapter-react";
import { TIERS } from "../config";
import { fmtAmount, fmtSol } from "../format";
import { goTo } from "../nav";
import { useDistributor, useStakePosition } from "../useDistributor";
import { ConnectToClaim } from "./claimShared";

/**
 * The staking terms, as a public page.
 *
 * This is the offer: what staking pays, what each lock costs, and why the
 * bonus is escrowed. It reads end to end without a wallet, because the terms
 * of a lockup are exactly what someone should be able to study before
 * connecting anything. The doing (staking, claiming, exiting) lives on
 * My Buddy with every other wallet action.
 */
export function Staking() {
  const { publicKey } = useWallet();
  const { pool } = useDistributor();
  const { position } = useStakePosition(publicKey ?? null);

  return (
    <div className="stack">
      <section className="card">
        <h2>Staking</h2>
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
          multiplier earns you. A 5.0× stake earns five times the share of the
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

        <h3 className="tiers-title">The locks you can choose from</h3>
        <TierCards selected={-1} onSelect={() => {}} />

        <p className="muted small">
          <strong>Why is there a 24-hour exit delay on Flexible?</strong> It is
          fairer to explain this than to hide it behind the word "flexible".
          Leaving is two steps: request to unstake, wait 24 hours, then withdraw
          whenever suits you — there is no window to miss, and your stake keeps
          earning through the whole day.
          <br />
          The delay is not friction for its own sake; it is what makes the
          rewards honest. Trading fees pile up in public view until anyone
          presses the button that hands them to stakers, and rewards are split
          among whoever is staked <em>at that instant</em>. Without a delay, a
          bot could stake a huge amount, trigger the payout, take the biggest
          share, and leave — all in one transaction, diluting everyone who was
          actually staying. With the delay, jumping in is free but jumping out
          costs a day, so grabbing a visible pot no longer works.
          <br />
          What never changes: <strong>nothing is at risk and nothing is
          forfeited on Flexible.</strong> You always get 100% of your tokens and
          all your rewards. Break a locked tier early and you lose the bonus
          plus 15%; Flexible has no equivalent, because there is nothing to
          break.
        </p>

        <p className="muted small">
          <strong>Locked tiers are separate lock-ups, not one pot.</strong> Lock
          today and again tomorrow, and you hold two independent lock-ups, each
          with its own amount, its own maturity date, and its own bonus — shown
          and withdrawn separately on My Buddy. The multiplier applies while a
          lock-up is running; once it matures, that lock-up earns at 1× like a
          flexible stake until you withdraw it, and its bonus is released in
          full. Anyone can flip a matured lock-up down to 1× (the demote crank
          on the Fund pool tab); withdrawing does it automatically.
        </p>

        <p className="muted small">
          <strong>The 24-hour floor is universal.</strong> The delay above is
          not just a flexible-tier rule — <em>no</em> route pulls staked
          principal back out inside the first 24 hours. Breaking a lock early
          already costs the bonus plus 15%, and on top of that it is simply not
          possible until the stake is a day old. So a locked tier can never be
          used as a way to unstake in minutes and dodge the protection the
          cooldown exists for: every tier, in and out, obeys the same day.
        </p>

        {!publicKey ? (
          <ConnectToClaim question="Ready to stake?" />
        ) : (
          <div className="claim-cta">
            <span>
              {position
                ? `You have ${fmtAmount(position.amount, true)} staked. Manage it, claim rewards, or add more on My Buddy.`
                : "Staking itself happens on My Buddy, the page for everything your wallet can do."}
            </span>
            <button className="primary" onClick={() => goTo("my buddy")}>
              {position ? "Manage my stake" : "Stake on My Buddy"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </section>

      {pool && (
        <section className="card">
          <h2>The pool, right now</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{fmtAmount(pool.totalStaked, true)}</span>
              <span className="stat-label">Total staked</span>
            </div>
            <div className="stat">
              <span className="stat-value">
                {fmtSol(pool.lifetimeSolRewards)} SOL
              </span>
              <span className="stat-label">SOL rewards paid to date</span>
            </div>
            <div className="stat">
              <span className="stat-value">
                {fmtAmount(pool.lifetimeTokenRewards, true)}
              </span>
              <span className="stat-label">Token rewards paid to date</span>
            </div>
          </div>
          <p className="muted small">
            Live from the chain. The Dashboard tab breaks the same numbers down
            further, and the Fund pool tab is where anyone can push waiting fees
            in.
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * The tiers as plans you pick between, not a spec table.
 *
 * Each card carries both halves of the trade (what you gain and what it costs),
 * because the cost is a real lockup with a real penalty, and burying that in
 * a footnote is how people end up surprised.
 *
 * Shared with My Buddy, where the same cards are the live tier picker for the
 * stake form; here they are display only.
 */
export function TierCards({
  selected,
  onSelect,
  ids,
}: {
  selected: number;
  onSelect: (id: number) => void;
  /** Restrict to these tier ids; the lock-up form passes the locked three. */
  ids?: number[];
}) {
  const tiers = ids ? TIERS.filter((t) => ids.includes(t.id)) : TIERS;
  return (
    <div className="tiers">
      {tiers.map((t) => {
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
