import { LEGACY_TOKEN } from "../config";
import { useUpgradeAuthority } from "../useUpgradeAuthority";

/**
 * The plain-English explainer.
 *
 * Deliberately written for someone who has never read a smart contract and is
 * mainly wondering whether they are about to be rugged again. It states the
 * costs and limits alongside the design, because a page that only lists upsides
 * reads exactly like the last one they believed.
 */
export function HowItWorks() {
  // The burn is a future event until it isn't. This site is live weeks before
  // launch day, so the claim below is written in whichever tense the chain
  // currently supports rather than the one we would prefer.
  const burned = useUpgradeAuthority().immutable === true;

  return (
    <div className="stack prose">
      <section className="card">
        <h2>Why this exists</h2>
        <p>
          The legacy Buddy token was abandoned by its creator, who sold into
          the community he built and kept collecting creator fees from a project
          he had walked away from.
        </p>
        <p>
          <strong>
            The idea was never the problem. The stewardship was.
          </strong>{" "}
          A message signed onto the Bitcoin blockchain in 2014, turned into a
          memecoin a decade later — that is a genuinely good story, the kind
          that does not need inventing and cannot be copied. It had a real
          origin, a real date, and a real key behind it. What it never had was
          anyone willing to keep showing up for it. It did not fail because the
          premise was weak; it failed because the person holding it left, and
          left in a way that made it impossible for anyone else to pick up.
        </p>
        <p>
          That is the entire premise of this project: take the story that
          deserved better and give it the structure it never had. Not a quick
          relaunch — something that can still be standing in five years, on
          pump.fun, where almost nothing is.
        </p>
        <p>
          A community takeover of the Legacy Buddy token would still have paid him. So
          this is a new token, and the difference is not that we are promising
          to behave better — it is that the rules are enforced by a program
          nobody can alter, including us. The story stays the same. What changes
          is that it no longer depends on anyone's good intentions.
        </p>

        <LegacyToken />
      </section>

      <section className="card">
        <h2>The four buckets</h2>
        <p className="muted">
          Everything the project holds sits in one contract, split four ways.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Who</th>
                <th>Window</th>
                <th>How it pays</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>Community stakers</td>
                <td>forever</td>
                <td>continuously, pro-rata</td>
              </tr>
              <tr>
                <td>2</td>
                <td>Legacy Buddy holders</td>
                <td>30 days</td>
                <td>instantly, no lockup</td>
              </tr>
              <tr>
                <td>3</td>
                <td>Influencers</td>
                <td>72 hours</td>
                <td>30-day stream on claim</td>
              </tr>
              <tr>
                <td>4</td>
                <td>The 2014 signer, and the Token Creator</td>
                <td>until 2030 / automatic</td>
                <td>12-month streams</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>One rule ties them together: anything unclaimed becomes
          staking rewards for the community.</strong> Influencers who never turn
          up, Legacy Buddy holders who never come back, the 2014 allocation if nobody
          claims it, tokens forfeited by people who break staking locks — all of
          it flows to the same place, and none of it comes back to us.
        </p>
      </section>

      <section className="card">
        <h2>If you held the Legacy Buddy token</h2>
        <p>
          A snapshot was taken at a block that had <em>already passed</em> when
          it was announced, chosen for a documented reason rather than a
          convenient price.
        </p>
        <p className="muted">
          That ordering matters. Announcing a snapshot in advance tells the whole
          market to go buy the Legacy Buddy token and farm the airdrop — which would have
          handed your restitution to speculators and paid the original creator's fees
          on the way through.
        </p>
        <p>
          Your tokens transfer <strong>the moment you claim, with no lockup.</strong>{" "}
          Sell them the same minute if you want to. This is owed to you; putting
          conditions on it would be its own insult.
        </p>
      </section>

      <section className="card">
        <h2>Where the staking pool's money comes from</h2>
        <p>
          Three sources: a 90% share of the trading fees this token earns on
          pump.fun, donations from anyone who wants to add to it, and every
          allocation in the system that nobody claimed.
        </p>
        <p className="muted">
          Fees do not flow in automatically — they build up at pump.fun until
          someone moves them. That someone can be any person reading this: the
          instructions involved are permissionless, and the Fund pool tab runs
          them from your own wallet. The team has no special ability to do it,
          and no ability to stop it.
        </p>
        <p className="muted">
          The remaining 10% of fees goes to the Token Creator. That is the only
          ongoing income from this project, and it is stated here so nobody has
          to guess.
        </p>
      </section>

      <section className="card">
        <h2>Staking, and why the multiplier is held back</h2>
        <p>
          Staking registers you for everything the ecosystem earns. Longer locks
          earn more — up to 5× for twelve months.
        </p>
        <p>
          <strong>Your base rewards are claimable at any time, in every tier.</strong>{" "}
          The extra your multiplier earns is held until your lock matures, and is
          forfeited if you leave early, along with 15% of your stake.
        </p>
        <p className="muted">
          Without that, someone could take the 5× rate, collect five times the rewards
          for a few weeks, walk away, and have been paid the full multiplier for
          a commitment they never kept — diluting everyone who actually locked.
          Break a lock and you keep roughly what a flexible staker would have
          earned, which is what you actually committed to.
        </p>
      </section>

      <section className="card">
        <h2>The 2014 allocation</h2>
        <p>
          Part of the supply is reserved for whoever holds the Bitcoin key that
          signed the message this whole story came from, back in 2014. They have
          until the end of 2030 to claim it.
        </p>
        <p>
          They need nothing from us to do it. That old transaction revealed their
          public key; the contract checks a signature against it directly, and
          the signed message names the destination so it cannot be intercepted
          and redirected.
        </p>
        <p>
          <strong>If they claim, the tokens are theirs — including the right to
          sell every one.</strong> We are saying so now, years before it could
          happen, so nobody can pretend later that it was not the deal. If nobody
          ever claims, it streams to the community as staking rewards — over
          the same period it would have streamed to its claimant, so an expiry
          is never a jackpot event for the pool.
        </p>
      </section>

      <section className="card">
        <h2>What stops us from doing what he did</h2>
        <p>
          <strong>The Token Creator's tokens are locked in the contract</strong>,
          released over twelve months behind a cliff. There is no wallet holding
          a pile that could be sold tomorrow.
        </p>
        {burned ? (
          <p>
            <strong>The contract cannot be modified.</strong> The upgrade
            authority was destroyed on launch day, before the token was
            announced. Not transferred, not time-locked — destroyed. The code
            that is running is the code that will always run.
          </p>
        ) : (
          <p>
            <strong>The contract will not be modifiable.</strong> The upgrade
            authority is due to be destroyed on launch day, before the token is
            announced — not transferred, not time-locked. It has not happened
            yet. Until the Verify tab reads <code>Authority: none</code>, this
            is a promise rather than a fact, and you should treat it as one.
          </p>
        )}
        <p>
          <strong>Every number is public.</strong> The eligibility list, the
          influencer allocations and amounts, the source code, the balances. The
          Verify tab shows you how to check all of it, and you should.
        </p>
      </section>

      <section className="card">
        <h2>What this costs, honestly</h2>
        <p className="muted">
          A page that only lists advantages is the same page the last project
          had. So:
        </p>
        <ul className="muted">
          <li>
            <strong>An immutable contract cannot be fixed.</strong> If there is a
            bug, nobody can patch it — not us, not anyone. A devnet rehearsal and
            an independent security review were the only two chances to catch
            one.
          </li>
          <li>
            <strong>Missing a claim window means missing it.</strong> The
            deadlines are enforced by the program. Nobody can make an exception,
            including for a good reason.
          </li>
          <li>
            <strong>Nothing here is a prediction about price.</strong> This
            describes mechanics. A memecoin can lose you everything you put in,
            and this one is no different.
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * The Legacy Buddy token, named and linked.
 *
 * Naming it is not a risk to manage — it is the evidence. Everything claimed
 * about the abandonment is visible in that token's own history, so the links
 * go to the places people already trust rather than to a screenshot of ours.
 */
function LegacyToken() {
  return (
    <div className="files">
      <div className="files-head">The original token</div>
      <div className="file-row">
        <div className="file-meta">
          <span className="mono file-name">{LEGACY_TOKEN.mint}</span>
          <span className="file-desc">
            The abandoned Buddy mint. This is the token the snapshot was taken
            from — not the one this site distributes.
          </span>
        </div>
      </div>
      {LEGACY_TOKEN.links.map((l) => (
        <div className="file-row" key={l.label}>
          <div className="file-meta">
            <span className="file-name">{l.label}</span>
            <span className="file-desc">{l.note}</span>
          </div>
          <div className="file-actions">
            <a href={l.url} target="_blank" rel="noreferrer noopener">
              open
            </a>
          </div>
        </div>
      ))}
      <p className="file-foot">
        Check the sell history against the launch date yourself. Nothing on this
        page about the Legacy Buddy token needs to be taken on our word.
      </p>
    </div>
  );
}
