import { Fragment, useState, type ReactNode } from "react";
import {
  BUCKET_SPLIT,
  LEGACY_TOKEN,
  ORIGINAL_MESSAGE,
  ORIGINAL_SIGNER_DEADLINE,
  PROGRAM_ID,
  SEEDS,
  btcTxUrl,
  pda,
} from "../config";
import { countdown, fmtAmount, fmtTokens } from "../format";
import { useDistributor, useStream } from "../useDistributor";
import { useUpgradeAuthority } from "../useUpgradeAuthority";
import {
  AuthorityDiagram,
  BucketFlowDiagram,
  FeeTrapDiagram,
  PayoutShapes,
  RouteGlyph,
  SnapshotDiagram,
} from "./illustrations";
import { TokenHandover } from "./TokenHandover";

/**
 * The front door, laid out as an engineering document rather than a coin page.
 *
 * Two things are being solved at once. A newcomer has to understand what this
 * is, what happened, and what they personally should do, so the copy is plain
 * and the routes are explicit. Someone who has been rugged before has to see
 * that whoever built this is precise, so the page is numbered, ruled, and
 * specified like a datasheet, and every assertion carries the command that
 * settles it one click away.
 *
 * Proof is never the opening move, and a claim is never rendered in a tense the
 * chain does not currently support.
 */
type SpecTone = "good" | "warn" | "bad" | "unknown" | "plain";

export function Landing({
  go,
}: {
  go: (tab: string, section?: string) => void;
}) {
  const { config, pool, vaultBalance, loading, error } = useDistributor();
  const upgrade = useUpgradeAuthority();
  // The dev stream is one account and it is the only way to tell "waiting for
  // the cliff" apart from "already dripping", which are very different states
  // to a reader deciding whether the team can sell yet.
  const { stream: devStream } = useStream(config?.devWallet ?? null);

  const now = Date.now() / 1000;
  const signerLeft = countdown(ORIGINAL_SIGNER_DEADLINE, now);
  const oldLeft = config ? countdown(Number(config.oldHolderDeadline), now) : null;
  const infLeft = config ? countdown(Number(config.influencerDeadline), now) : null;
  const chainReadable = !error && !loading && !!config;
  // True only once the chain says so. Never assume the burn has happened.
  const burned = upgrade.immutable === true;

  // The live mint, read from the contract rather than pasted into the source.
  // Before launch there is nothing to read and the buy route says so plainly,
  // which is also when impersonation scams are most likely, so it says that too.
  const newMint: string | null = chainReadable
    ? config.rewardMint?.toBase58?.() ?? null
    : null;

  // Names who holds the power, and the note says what they can do with it.
  // "changeable" described a property of the contract and left the reader to
  // work out who could exercise it and whether that was bad; "creator", in
  // red, answers both before anyone has to think about it. Red rather than
  // amber on purpose: until the burn, one person can replace every rule on
  // this page, and that is not a caution, it is the thing at stake.
  const authorityCell = upgrade.loading
    ? { v: "reading…", t: "unknown" as const, note: "checking the chain" }
    : upgrade.error || upgrade.immutable === null
    ? { v: "unread", t: "unknown" as const, note: "could not reach the chain" }
    : upgrade.immutable
    ? { v: "none", t: "good" as const, note: "nobody can change the contract" }
    : { v: "creator", t: "bad" as const, note: "can still rewrite the rules" };

  /**
   * One cell per bucket, so the strip answers "what is still up for grabs, and
   * how long have they got" for each of them rather than only for the legacy
   * holders. Each carries the amount and the clock, because either alone
   * invites the other question.
   */
  const bucketCell = (
    label: string,
    remaining: bigint,
    left: string | null,
    opts: { swept?: boolean; claimed?: boolean; sweptNote: string }
  ) => {
    if (!chainReadable) {
      return { label, value: "unread", tone: "unknown" as const, note: "could not reach the chain" };
    }
    if (opts.claimed) {
      return { label, value: "claimed", tone: "good" as const, note: "it found its owner" };
    }
    if (opts.swept) {
      return { label, value: "0", tone: "good" as const, note: opts.sweptNote };
    }
    if (!left) {
      return {
        label,
        value: fmtAmount(remaining, true),
        tone: "warn" as const,
        note: "window closed, awaiting sweep",
      };
    }
    return {
      label,
      value: fmtAmount(remaining, true),
      tone: "plain" as const,
      note: `${left} left to claim`,
    };
  };

  const remainingOf = (alloc: any, claimed: any): bigint =>
    chainReadable ? BigInt(alloc.toString()) - BigInt(claimed.toString()) : 0n;

  /**
   * The initial distribution: what the launch buy acquired and `fund_vault`
   * moved into the contract, read back as the sum of the four frozen
   * allocations. Constant from the lock onwards, unlike the vault balance,
   * which falls as people claim — so this is the figure the pre-commitment
   * document publishes and the one the page should state.
   */
  const initialDistribution: bigint | null = chainReadable
    ? [
        config.oldHolderAllocation,
        config.influencerAllocation,
        config.originalSignerAllocation,
        config.devAllocation,
      ]
        .map((a: any) => BigInt(a.toString()))
        .reduce((sum: bigint, b: bigint) => sum + b, 0n)
    : null;

  /**
   * Each bucket's share of the initial distribution, as a percentage.
   *
   * Derived from the on-chain allocations whenever the config is readable,
   * because those are what the lock froze and what the vault actually backs;
   * the published BUCKET_SPLIT constants only fill in before the program is
   * initialized on this cluster. If we ever committed one split and
   * initialized another, this page would say so by disagreeing with the
   * pre-commitment document, which is exactly the kind of lie the site is
   * built to make visible.
   */
  const shareOf =
    initialDistribution && initialDistribution > 0n
      ? (alloc: any) => {
          const pct =
            Number((BigInt(alloc.toString()) * 1000n) / initialDistribution) / 10;
          return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
        }
      : null;

  const shares = {
    legacy: shareOf ? shareOf(config.oldHolderAllocation) : `${BUCKET_SPLIT.legacyHolders}%`,
    influencers: shareOf ? shareOf(config.influencerAllocation) : `${BUCKET_SPLIT.influencers}%`,
    signer: shareOf ? shareOf(config.originalSignerAllocation) : `${BUCKET_SPLIT.originalSigner}%`,
    team: shareOf ? shareOf(config.devAllocation) : `${BUCKET_SPLIT.team}%`,
  };

  /**
   * The amber line under each allocation row: where that bucket is in its own
   * lifecycle, right now.
   *
   * The two multi-person buckets can only speak about the window, since there
   * is no single stream to count down; the two single-claimant ones can follow
   * their money all the way through. Writing one generic line for all four
   * would have meant saying nothing true about any of them.
   */
  const legacyClock = !config
    ? null
    : config.oldHolderSwept
      ? "window closed, the rest went to stakers"
      : oldLeft
        ? `${oldLeft} left to claim`
        : "claim deadline passed, awaiting sweep";

  const influencerClock = !config
    ? null
    : config.influencerSwept
      ? "window closed, the rest is streaming to stakers"
      : infLeft
        ? `${infLeft} left to claim`
        : "claim deadline passed, awaiting sweep";

  const signerClock = !config
    ? null
    : config.originalSignerClaimed
      ? "claimed, now streaming over 12 months"
      : config.originalSignerSwept
        ? "never claimed, now streaming to stakers"
        : signerLeft
          ? `${signerLeft} left to claim`
          : "deadline passed, awaiting sweep";

  const teamClock = (() => {
    if (!config) return null;
    // The live slot already says "not set up yet" in this state, and a clock
    // repeating it would just be a second line saying nothing new.
    if (!config.devStreamCreated || !devStream) return null;
    const cliff = Number(devStream.cliff);
    const end = Number(devStream.end);
    if (now < cliff) {
      return `${countdown(cliff, now)} before the first token unlocks`;
    }
    const left = countdown(end, now);
    return left ? `streaming, ${left} left` : "fully released";
  })();

  const specCells = [
    {
      label: "Who can change the contract",
      value: authorityCell.v,
      tone: authorityCell.t,
      note: authorityCell.note,
    },
    {
      label: "Team's tokens",
      value: !chainReadable ? "unread" : config.devStreamCreated ? "locked up" : "not locked",
      tone: (!chainReadable
        ? "unknown"
        : config.devStreamCreated
          ? "good"
          : "bad") as SpecTone,
      note: !chainReadable
        ? "could not reach the chain"
        : config.devStreamCreated
          ? "released over 12 months, none early"
          : "the lock has not been set up yet",
    },
    {
      label: "Unclaimed tokens go to",
      value: "stakers",
      tone: "good" as const,
      note: "never back to the team",
    },
    bucketCell(
      "Awaiting claim by legacy holders",
      remainingOf(config?.oldHolderAllocation ?? 0, config?.oldHolderClaimed ?? 0),
      oldLeft,
      { swept: config?.oldHolderSwept, sweptNote: "all of it went to stakers" }
    ),
    bucketCell(
      "Awaiting claim by influencers",
      remainingOf(config?.influencerAllocation ?? 0, config?.influencerClaimed ?? 0),
      infLeft,
      { swept: config?.influencerSwept, sweptNote: "now streaming to stakers" }
    ),
    bucketCell(
      "Awaiting claim by the 2014 signer",
      chainReadable ? BigInt(config.originalSignerAllocation.toString()) : 0n,
      signerLeft,
      {
        swept: config?.originalSignerSwept,
        claimed: config?.originalSignerClaimed,
        sweptNote: "now streaming to stakers",
      }
    ),
    {
      label: "Held in the contract",
      value: chainReadable ? fmtAmount(vaultBalance, true) : "unread",
      tone: (chainReadable ? "plain" : "unknown") as SpecTone,
      note: chainReadable ? "every allocation above, in one vault" : "could not reach the chain",
    },
  ];

  return (
    <div className="landing">
      {/* ---- what this is ---------------------------------- */}
      <section className="l-hero">
        <h2 className="l-display">
          Same story,
          <br />
          but built to last.
          <br />
          <span className="l-display-accent">Rules that can't be rewritten.</span>
        </h2>
        <p className="l-lede">
          <span className="accented italicized">$BUDDY</span> is the rebirth of an existing
          memecoin by the same ticker. The last one's dev sold everything into the
          community he built and walked away. The community stayed and kept pushing
          anyway — uphill, because the one person with the creator's powers and the
          creator's fee stream was no longer behind it.
          This is the rebirth, and the only real
          difference is this: the promises are written in code (smart contracts) that no one can
          edit later, instead of posts that can be deleted.
        </p>

        <div className="l-actions">
          <button className="l-btn l-btn-solid" onClick={() => go("claims", "overview")}>
            See if you can claim <span aria-hidden="true">→</span>
          </button>
          <button className="l-btn" onClick={() => go("verify")}>
            Check all of this yourself <span aria-hidden="true">→</span>
          </button>
        </div>

        {/* The hero's claim, drawn. Placed inside the hero rather than after
            the spec strip so the narrative beat lands before the data does;
            the strip below is the summary of this, not a separate section. */}
        <TokenHandover />
      </section>

      {/* ---- the spec strip ------------------------------------------ */}
      {/* Rolling, like the ticker under it, because it now carries a cell per
          claim bucket and seven cells will not sit still on one line without
          shrinking each to uselessness. Pauses on hover: these are numbers,
          not a slogan, and a reader must be able to stop and read one. */}
      <div className="l-spec">
        <div className="l-spec-run">
          {[0, 1].map((copy) => (
            <Fragment key={copy}>
              {specCells.map((cell, i) => (
                <SpecCell key={`${copy}-${i}`} {...cell} ariaHidden={copy === 1} />
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {/* The first item tracks the chain rather than asserting a burn that has
          not happened. The cell above says the creator can still rewrite the
          rules until launch day, and a ticker claiming "immutable program"
          beside it would be the page contradicting itself in the reader's
          eye-line. */}
      <div className="l-ticker" aria-hidden="true">
        <div className="l-ticker-run">
          {Array.from({ length: 2 }, (_, i) => (
            <span key={i}>
              {burned ? "immutable program" : "upgrade authority burns at launch"}{" "}
              <i>·</i> merkle snapshot <i>·</i> no presale{" "}
              <i>·</i> no team wallet <i>·</i> permissionless payouts <i>·</i>{" "}
              on-chain bitcoin signature <i>·</i> published exclusions <i>·</i>{" "}
              reproducible build <i>·</i>{" "}
            </span>
          ))}
        </div>
      </div>

      {/* ---- provenance ------------------------------------------ */}
      <Section label="Provenance" title="How it got here">
        <ol className="l-index">
          {/* The message itself, not a description of it. This row is the
              origin of the name and the one fact on the page that predates
              everyone involved. Paraphrasing it while the real thing sits
              one link away was leaving the best evidence off the page. */}
          <IndexRow
            when="2014"
            title="Someone wrote a message onto the Bitcoin blockchain."
            body={
              <>
                <q className="l-quote">{ORIGINAL_MESSAGE.message}</q>. Still
                there, permanently, in block{" "}
                {ORIGINAL_MESSAGE.block.toLocaleString()}, and it is where the
                name comes from.{" "}
                <a
                  href={btcTxUrl(ORIGINAL_MESSAGE.txid)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Read it on the blockchain <span aria-hidden="true">&#8599;</span>
                </a>
              </>
            }
          />
          <IndexRow
            when="A decade later"
            title="That message became a memecoin."
            body="A good story with a real date behind it, the kind you cannot invent. Thousands of people bought in."
          />
          <IndexRow
            when="Then"
            title="Its creator sold his entire holding and walked away."
            body="The community stayed and kept it trading anyway — pushing uphill, because the creator's powers left with him, and every trade people made still paid him a fee."
          />
          <IndexRow
            when="Now"
            title="A new coin, same story, different plumbing."
            body="People who held the old one get a share of this one for free. And the things a creator would need in order to do that again have been removed. Not promised away, removed."
            current
          />
        </ol>

        <Figure
          caption="$BUDDY trading fee flow"
        >
          <FeeTrapDiagram />
        </Figure>

        {/* <div className="l-source">
          <span className="l-micro">Source · the Legacy Buddy coin</span>
          <code>{LEGACY_TOKEN.mint}</code>
          <span className="l-source-links">
            {LEGACY_TOKEN.links.map((l) => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                title={l.note}
              >
                {l.label} <span aria-hidden="true">↗</span>
              </a>
            ))}
          </span>
        </div> */}
      </Section>

      {/* ---- routes ---------------------------------------------- */}
      <Section
        label="Routes"
        title="Which of these is you?"
        intro="There are really only four reasons to be here. Pick the one that fits."
      >
        <div className="l-routes">
          <Route
            glyph="buy"
            title="I just want to buy some"
            body={
              newMint
                ? "It trades on pump.fun like any other coin. Nothing on this site sells it to you: there is no presale, no allocation reserved for buyers, and no wallet to send anything to."
                : "It isn't launched yet, so there is nothing to buy. Anyone offering to sell you Buddy right now, or asking you to send them anything, is scamming you. When it launches it will trade on pump.fun like any other coin."
            }
            note={
              newMint
                ? "Check the address matches this one before you buy anything."
                : "This is the only official site. Come back here for the real address rather than trusting a link."
            }
            address={newMint}
            cta={newMint ? "Open on pump.fun" : "Not launched yet"}
            href={newMint ? `https://pump.fun/coin/${newMint}` : undefined}
            disabled={!newMint}
          />
          {/* Three separate ways to be owed something, and they pay out on
              three different terms, so no single closing line is true of all
              of them, and the old one ("arrives instantly") was only true of
              the first. Listed rather than run together, because a reader is
              looking for the one that describes them. */}
          <Route
            glyph="claim"
            title="I have a claim allocation"
            body={
              <>
                Tokens are reserved for you if any of these is true:
                <ul className="l-route-cases">
                  <li>
                    I held the legacy coin just before this new one dropped
                  </li>
                  <li>
                    I have been invited as a KOL to promote and talk about the
                    project publicly
                  </li>
                  <li>
                    I am the signer of the original 2014 message on the Bitcoin
                    blockchain
                  </li>
                </ul>
                Each pays out on its own terms. Enter a wallet address to see
                what it is owed.
              </>
            }
            cta="Check my wallet"
            onClick={() => go("claims", "overview")}
            primary
          />
          <Route
            glyph="stake"
            title="I want to earn from this coin"
            body="Staking means locking your tokens into the contract. While they sit there you earn a share of everything the project takes in: trading fees from pump.fun, plus every allocation nobody else claimed. Longer locks earn a bigger share, up to five times."
            note="Breaking a lock early costs the whole bonus plus 15% of your stake, and it goes to the stakers who stayed — and even that early exit is barred for the first 24 hours. There is also a no-lock option with no penalty at all, where leaving takes 24 hours from the moment you ask. Nothing leaves inside a day, whichever route you take."
            cta="See the staking terms"
            onClick={() => go("staking")}
          />
          <Route
            glyph="verify"
            title="I've been burned before and I don't trust any of this"
            body="Correct instinct, and this site is built for it. Every claim made here is something you can confirm yourself against the blockchain, with commands you can copy and run. You do not have to take our word for a single thing."
            note="If you can read code, please check ours and say publicly what you find, including if it's bad."
            cta="Show me how to check"
            onClick={() => go("verify")}
          />
        </div>
      </Section>

      {/* ---- allocation ------------------------------------------ */}
      <Section
        label="Allocation"
        title="Where the coins go"
        intro="After the launch of this new coin, the original supply purchased by the team at launch was sent in its entirety to the smart contract. That supply was then split by the contract into the four allocation groups below, and each group has its own rules for how and when it can be claimed. The percentages are frozen on chain by the config lock, so what you read here is what the contract enforces, not what we remembered to update."
      >
        <Sub title="The four splits" />
        <div className="l-alloc">
          <AllocRow
            who="People who held the Legacy Buddy coin"
            share={shares.legacy}
            window="30 days to claim"
            body="Free tokens as restitution, paid the moment you claim, with no lockup of any kind."
            live={
              config
                ? `${fmtTokens(config.oldHolderClaimed, true)} of ${fmtAmount(config.oldHolderAllocation, true)} claimed`
                : null
            }
            clock={legacyClock}
          />
          <AllocRow
            who="Influencers"
            share={shares.influencers}
            window="72 hours to claim"
            body="People asked to talk about the project publicly. Their tokens release slowly across 30 days rather than arriving at once, so nobody can promote it and dump the same day. To be straight about the limit: the contract cannot tell whether they actually posted, so this is their word, not code."
            live={
              config
                ? `${fmtTokens(config.influencerClaimed, true)} of ${fmtAmount(config.influencerAllocation, true)} claimed`
                : null
            }
            clock={influencerClock}
          />
          <AllocRow
            who="Whoever signed that 2014 message"
            share={shares.signer}
            window="reserved until end of 2030"
            body="Held in reserve, in case the original person ever shows up. They would prove it by signing with the same Bitcoin key. The contract checks the signature itself, so they need no permission from us, and it streams to them over 12 months. If they never appear, it streams to the staking community instead, on that same 12-month schedule."
            live={
              config
                ? config.originalSignerClaimed
                  ? "claimed, the original signer came back"
                  : `${fmtAmount(config.originalSignerAllocation, true)} still waiting`
                : null
            }
            clock={signerClock}
          />
          <AllocRow
            who="The team"
            share={shares.team}
            window="12 months, drip-fed"
            body="The team's tokens are not in a wallet anyone can spend from. They sit inside the contract and trickle out daily across a year, after an initial waiting period, to a multisig that needs more than one team member to agree before anything moves. There is no button, not even for them, that releases it early."
            live={
              config
                ? config.devStreamCreated
                  ? `${fmtAmount(config.devAllocation, true)} locked in the contract`
                  : "not set up yet"
                : null
            }
            clock={teamClock}
          />
        </div>
        <p className="l-micro" style={{ marginTop: 8 }}>
          {shareOf && initialDistribution ? (
            <>
              Shares are read live from the contract's frozen allocations.
              Together they total {fmtAmount(initialDistribution, true)}: the
              initial distribution, every token the launch buy acquired.{" "}
            </>
          ) : (
            <>
              Shares are the published pre-commitment split; the chain shows
              the same numbers, and the exact distributor total, once the
              program is initialized at launch.{" "}
            </>
          )}
          The staking pool starts at 0% by design and is fed by fees and
          forfeits.
        </p>

        <Sub
          title="How you actually get paid"
          blurb="Three different shapes, and the words for them get used loosely everywhere else. Cumulative tokens received, against time."
        />
        <PayoutShapes />

        <Sub
          title="And what happens to the rest"
          blurb="Three of the allocations above have a claim deadline, and all three have the same consequence when it passes."
        />
        <Figure
          caption="Unclaimed allocations, forfeited staking escrow, trading fees and donations all end in the same place."
        >
          <BucketFlowDiagram />
        </Figure>

        <div className="l-rule">
          <span className="l-micro">The rule for anything left over</span>
          <p className="l-rule-line">
            Anything nobody claims becomes rewards for the people who stake.
          </p>
          <p className="l-rule-body">
            Influencers who never turn up. Legacy Buddy holders who never come back. The
            2014 reserve if nobody ever proves it. Tokens given up by people who
            break a staking lock early. All of it goes to the same place, and
            none of it can come back to the team. There is no instruction in the
            contract that would let it.
          </p>
          {pool && (
            <p className="l-rule-live">
              <span className="l-rule-num">
                {fmtAmount(pool.lifetimeTokenRewards, true)}
              </span>
              <span className="l-micro">has gone into that pool so far</span>
            </p>
          )}
        </div>
      </Section>

      {/* ---- verification ---------------------------------------- */}
      <Section
        label="Verification"
        title="Why you don't have to trust us"
        intro="Three things a creator would need in order to do what the last one did. Each says plainly what has been done about it, and each opens into the exact command that settles it."
      >
        <Proof
          question="Could the team quietly change the rules later?"
          answer={
            upgrade.loading
              ? "Checking…"
              : upgrade.error || upgrade.immutable === null
              ? "Couldn't read it, check yourself"
              : upgrade.immutable
              ? "No, the code is permanent"
              : "Not yet, happens at launch"
          }
          tone={
            upgrade.loading || upgrade.error || upgrade.immutable === null
              ? "unknown"
              : upgrade.immutable
              ? "good"
              : "warn"
          }
          plain={
            <>
              On Solana, whoever launches a contract can normally replace its
              code afterwards. That means every rule it contains can be quietly
              rewritten, which is why "our contract is locked" is close to
              meaningless on its own. That power gets permanently destroyed here,
              before the coin is announced to anybody.{" "}
              {upgrade.immutable === true ? (
                <>It has been done, and the command below confirms it.</>
              ) : (
                <>
                  It has <em>not</em> happened yet. Until the command below says
                  otherwise, treat this as a promise rather than a fact.
                </>
              )}
            </>
          }
          command={`solana program show ${PROGRAM_ID.toBase58()}`}
          hint="Look at the line that says Authority. If it reads none, the code can never change again, not by us and not by anyone."
          figure={<AuthorityDiagram />}
          figureCaption="This is the check almost nobody performs, and it is the one that decides whether any other promise on this page is enforceable."
        />

        <Proof
          question="Could the team dump a huge bag on everyone?"
          answer={
            !chainReadable
              ? "Couldn't read it, check yourself"
              : config.devStreamCreated
              ? "No, locked for 12 months"
              : "Not set up yet"
          }
          tone={
            !chainReadable ? "unknown" : config.devStreamCreated ? "good" : "warn"
          }
          plain={
            <>
              This is exactly what the last coin's dev did. Here the team's tokens
              are not initially in a wallet they control. They sit in the contract and
              come out a little each day for twelve months, after a waiting
              period at the start. Nobody can speed that up, including them.
            </>
          }
          command={`spl-token balance --address ${pda([SEEDS.vault]).toBase58()}`}
          hint="This is the contract's own balance. Everything owed to people who haven't claimed yet, plus everyone's staked tokens, has to physically be in there."
          live={
            chainReadable ? `Holding ${fmtAmount(vaultBalance)} right now` : null
          }
        />

        <Proof
          question="Is the list of who gets what actually honest?"
          answer="Rebuild it yourself and compare"
          tone="check"
          plain={
            <>
              The list of Legacy Buddy holders had to be worked out away from the
              blockchain, because a Solana contract cannot read who holds what.
              That is only worth anything if anyone else can repeat the exercise
              and get an identical answer, so the full holder list is published,
              along with every address deliberately left out and the reason for
              each.
            </>
          }
          command="npx ts-node scripts/verify-snapshot.ts --onchain"
          hint="If the fingerprint it prints doesn't match the one recorded in the contract, we are lying, and it takes about thirty seconds to prove."
          figure={<SnapshotDiagram />}
          figureCaption="The whole list is crushed down into one fingerprint. Adding a wallet, or quietly changing an amount, produces a different fingerprint and stops matching the contract."
        />
      </Section>

      {/* ---- disclosure ------------------------------------------ */}
      <Section
        label="Disclosure"
        title="What we're not going to pretend"
        intro="A page that only lists good news is the same page the last project had."
      >
        <ol className="l-index l-index-tight">
          <IndexRow
            when="Risk"
            title="It's a memecoin, and it can go to zero."
            body="Nothing here is a prediction about price, a projection, or advice. You can lose everything you put in, exactly like any other coin. The contract being fair does not make the coin go up."
          />
          <IndexRow
            when="Trade-off"
            title="Permanent code can never be fixed either."
            body="Making the contract unchangeable also means that if there is a mistake in it, nobody can repair it. Not us, not anyone, ever. A full rehearsal on a test network and an exhaustive automated test suite were the chances to catch one, and the source is public for anyone to read. We chose that anyway, because a contract someone can rewrite is a contract you have to trust someone about, and this community has already been asked to do that once."
          />
          <IndexRow
            when="Deadlines"
            title="Miss a claim window and it's gone."
            body="The windows are enforced by the contract. Nobody can make an exception, however good the reason."
          />
          <IndexRow
            when="Us"
            title="We can't steal it, but we can lose interest."
            body="The mechanism makes a rug impossible. It does not make us show up forever. That risk is real and we're not going to pretend otherwise, though the contract keeps running either way, and anyone at all can trigger the payouts, not just us."
          />
        </ol>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  label,
  title,
  intro,
  children,
}: {
  label: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="l-section">
      <div className="l-section-rail">
        <span className="l-micro">{label}</span>
      </div>
      <div className="l-section-body">
        <h2 className="l-h2">{title}</h2>
        {intro && <p className="l-intro">{intro}</p>}
        {children}
      </div>
    </section>
  );
}

/** A titled break inside a long section, so nothing runs on for a full screen. */
function Sub({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="l-sub">
      <h3>{title}</h3>
      {blurb && <p>{blurb}</p>}
    </div>
  );
}

/** A diagram with its plate number and caption, set like a figure in a report. */
function Figure({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="l-figure">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function SpecCell({
  label,
  value,
  tone,
  note,
  ariaHidden,
}: {
  label: string;
  value: string;
  tone: SpecTone;
  note: string;
  /** The marquee renders every cell twice; the copy must not be read aloud. */
  ariaHidden?: boolean;
}) {
  return (
    <div className="l-spec-cell" aria-hidden={ariaHidden || undefined}>
      <span className="l-micro">{label}</span>
      <span className={`l-spec-value l-tone-${tone}`}>{value}</span>
      <span className="l-spec-note">{note}</span>
    </div>
  );
}

function IndexRow({
  when,
  title,
  body,
  current,
}: {
  when: string;
  title: string;
  body: ReactNode;
  current?: boolean;
}) {
  return (
    <li className={current ? "l-index-row l-index-current" : "l-index-row"}>
      <span className="l-index-when">{when}</span>
      <div className="l-index-text">
        <strong>{title}</strong> {body}
      </div>
    </li>
  );
}

function Route({
  glyph,
  title,
  body,
  note,
  clock,
  cta,
  onClick,
  href,
  disabled,
  address,
  primary,
}: {
  glyph: "buy" | "claim" | "stake" | "verify";
  title: string;
  body: ReactNode;
  /** Omitted where a single closing line would not be true of every case. */
  note?: string;
  clock?: string | null;
  cta: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  address?: string | null;
  primary?: boolean;
}) {
  return (
    <div className={primary ? "l-route l-route-primary" : "l-route"}>
      <div className="l-route-head">
        <RouteGlyph kind={glyph} />
        <h3>{title}</h3>
        {clock && <span className="l-route-clock">{clock}</span>}
      </div>
      {/* A div, not a p: one route's body carries a <ul> of claim cases, and
          block content inside a paragraph is invalid HTML that React warns
          about on every render. The stylesheet targets the class, so the
          typography is identical. */}
      <div className="l-route-body">{body}</div>
      {address && <code className="l-route-address">{address}</code>}
      {note && <p className="l-route-note">{note}</p>}
      {href ? (
        <a
          className="l-btn l-btn-solid"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {cta} <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <button
          className={primary ? "l-btn l-btn-solid" : "l-btn"}
          onClick={onClick}
          disabled={disabled}
        >
          {cta} <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}

function AllocRow({
  who,
  share,
  window: win,
  body,
  live,
  clock,
}: {
  who: string;
  /** This bucket's slice of the initial distribution, e.g. "15%". */
  share?: string | null;
  window: string;
  body: string;
  live: string | null;
  clock?: string | null;
}) {
  return (
    <div className="l-alloc-row">
      <div className="l-alloc-main">
        <h3>
          {who}
          {share && <span className="l-alloc-share">{share}</span>}
        </h3>
        <p>{body}</p>
      </div>
      <div className="l-alloc-meta">
        <span className="l-micro">{win}</span>
        {live && <span className="l-alloc-live">{live}</span>}
        {clock && <span className="l-alloc-clock">{clock}</span>}
      </div>
    </div>
  );
}

/**
 * A plain question, a plain answer, and the command that settles it, folded
 * away by default so the page reads as English until someone asks for proof.
 */
function Proof({
  question,
  answer,
  tone,
  plain,
  command,
  hint,
  live,
  figure,
  figureCaption,
}: {
  question: string;
  answer: string;
  tone: "good" | "warn" | "unknown" | "check";
  plain: React.ReactNode;
  command: string;
  hint: string;
  live?: string | null;
  figure?: React.ReactNode;
  figureCaption?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="l-proof">
      <div className="l-proof-head">
        <h3>{question}</h3>
        <span className={`l-proof-answer l-tone-${tone}`}>{answer}</span>
      </div>
      <p className="l-proof-body">{plain}</p>
      {figure && (
        <figure className="l-figure l-figure-inset">
          {figure}
          {figureCaption && <figcaption>{figureCaption}</figcaption>}
        </figure>
      )}
      {live && <p className="l-proof-live">{live}</p>}
      <details className="l-details">
        <summary>Show the command that proves it</summary>
        <div className="l-cmd">
          <code>{command}</code>
          <button onClick={copy}>{copied ? "copied" : "copy"}</button>
        </div>
        <p className="l-proof-hint">{hint}</p>
      </details>
    </div>
  );
}
