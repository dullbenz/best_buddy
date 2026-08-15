import { useState } from "react";
import {
  LEGACY_TOKEN,
  ORIGINAL_SIGNER_DEADLINE,
  PROGRAM_ID,
  SEEDS,
  pda,
} from "../config";
import { countdown, fmtAmount, fmtTokens } from "../format";
import { useDistributor } from "../useDistributor";
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
 * is, what happened, and what they personally should do — so the copy is plain
 * and the routes are explicit. Someone who has been rugged before has to see
 * that whoever built this is precise — so the page is numbered, ruled, and
 * specified like a datasheet, and every assertion carries the command that
 * settles it one click away.
 *
 * Proof is never the opening move, and a claim is never rendered in a tense the
 * chain does not currently support.
 */
export function Landing({
  go,
}: {
  go: (tab: string, section?: string) => void;
}) {
  const { config, pool, vaultBalance, loading, error } = useDistributor();
  const upgrade = useUpgradeAuthority();

  const now = Date.now() / 1000;
  const signerLeft = countdown(ORIGINAL_SIGNER_DEADLINE, now);
  const oldLeft = config ? countdown(Number(config.oldHolderDeadline), now) : null;
  const chainReadable = !error && !loading && !!config;
  // True only once the chain says so. Never assume the burn has happened.
  const burned = upgrade.immutable === true;

  // The live mint, read from the contract rather than pasted into the source.
  // Before launch there is nothing to read and the buy route says so plainly —
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
          memecoin by the same ticker. The last one was dumped and abandoned by the dev
          — they sold everything into the community.
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
            the spec strip so the narrative beat lands before the data does —
            the strip below is the summary of this, not a separate section. */}
        <TokenHandover />
      </section>

      {/* ---- the spec strip ------------------------------------------ */}
      <div className="l-spec">
        <SpecCell
          label="Who can change the contract"
          value={authorityCell.v}
          tone={authorityCell.t}
          note={authorityCell.note}
        />
        {/* "pending" was the worst label on the page: it read as a harmless
            in-progress state when it means the creator's tokens are *not* in
            the lock yet, which is the one thing this cell exists to rule
            out. */}
        <SpecCell
          label="Creator's tokens"
          value={
            !chainReadable
              ? "unread"
              : config.devStreamCreated
                ? "locked up"
                : "not locked"
          }
          tone={
            !chainReadable ? "unknown" : config.devStreamCreated ? "good" : "bad"
          }
          note={
            !chainReadable
              ? "could not reach the chain"
              : config.devStreamCreated
                ? "released over 12 months, none early"
                : "the lock has not been set up yet"
          }
        />
        <SpecCell
          label="Unclaimed tokens go to"
          value="stakers"
          tone="good"
          note="never back to the team"
        />
        <SpecCell
          label="Legacy holders have"
          value={oldLeft ?? "—"}
          tone={oldLeft ? "warn" : "unknown"}
          note={oldLeft ? "left to claim" : "claim window not open yet"}
        />
        <SpecCell
          label="Waiting to be claimed"
          value={chainReadable ? fmtAmount(vaultBalance, true) : "unread"}
          tone={chainReadable ? "plain" : "unknown"}
          note={chainReadable ? "sitting in the contract, not a wallet" : "could not reach the chain"}
        />
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
          <IndexRow
            when="2014"
            title="Someone wrote a message onto the Bitcoin blockchain."
            body="It is still there, permanently, and it is where the name comes from. Whoever did it has never been identified."
          />
          <IndexRow
            when="A decade later"
            title="That message became a memecoin."
            body="A good story with a real date behind it — the kind you cannot invent. Thousands of people bought in."
          />
          <IndexRow
            when="Then"
            title="Its creator sold his entire holding and walked away."
            body="The price collapsed. Worse, every trade people made afterwards still paid him a fee, so there was no way for the community to take it over without funding the person who had just left."
          />
          <IndexRow
            when="Now"
            title="A new coin, same story, different plumbing."
            body="People who held the old one get a share of this one for free. And the things a creator would need in order to do that again have been removed — not promised away, removed."
            current
          />
        </ol>

        <Figure
          caption="The trap: on the Legacy Buddy coin, the fee from every trade kept paying the person who had already sold and left. That is why the community could not simply take it over — doing so would have funded him."
        >
          <FeeTrapDiagram />
        </Figure>

        <div className="l-source">
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
        </div>
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
          <Route
            glyph="claim"
            title="I held the Legacy Buddy coin"
            body="You have tokens waiting, free. A list of everyone who held the Legacy Buddy coin was recorded from public blockchain history, and your share is reserved for your wallet. Connect it and the site tells you yes or no in a second."
            note="Claimed tokens arrive instantly and are yours — sell them the same minute if you want."
            clock={oldLeft ? `${oldLeft} left` : null}
            cta="Check my wallet"
            onClick={() => go("claims", "overview")}
            primary
          />
          <Route
            glyph="stake"
            title="I want to earn from this coin"
            body="Staking means locking your tokens into the contract. While they sit there you earn a share of everything the project takes in — trading fees from pump.fun, plus every allocation nobody else claimed. Longer locks earn a bigger share, up to five times."
            note="Breaking a lock early costs the whole bonus plus 15% of your stake, and it goes to the stakers who stayed. There is also a no-lock option with no penalty at all, where leaving takes three days from the day you ask."
            cta="See the staking terms"
            onClick={() => go("staking")}
          />
          <Route
            glyph="verify"
            title="I've been burned before and I don't trust any of this"
            body="Correct instinct, and this site is built for it. Every claim made here is something you can confirm yourself against the blockchain, with commands you can copy and run. You do not have to take our word for a single thing."
            note="If you can read code, please check ours and say publicly what you find — including if it's bad."
            cta="Show me how to check"
            onClick={() => go("verify")}
          />
        </div>
      </Section>

      {/* ---- allocation ------------------------------------------ */}
      <Section
        label="Allocation"
        title="Where the coins go"
        intro="The supply is split four ways, and every split was fixed in the contract before anyone could claim anything."
      >
        <Sub title="The four splits" />
        <div className="l-alloc">
          <AllocRow
            who="People who held the Legacy Buddy coin"
            window="30 days to claim"
            body="Free tokens as restitution, paid the moment you claim, with no lockup of any kind."
            live={
              config
                ? `${fmtTokens(config.oldHolderClaimed, true)} of ${fmtAmount(config.oldHolderAllocation, true)} claimed`
                : null
            }
          />
          <AllocRow
            who="Influencers"
            window="72 hours to claim"
            body="People asked to talk about the project publicly. Their tokens release slowly across 30 days rather than arriving at once, so nobody can promote it and dump the same day. To be straight about the limit: the contract cannot tell whether they actually posted, so this is their word, not code."
            live={
              config
                ? `${fmtTokens(config.influencerClaimed, true)} of ${fmtAmount(config.influencerAllocation, true)} claimed`
                : null
            }
          />
          <AllocRow
            who="Whoever signed that 2014 message"
            window="reserved until end of 2030"
            body="Held in reserve, in case the original person ever shows up. They would prove it by signing with the same Bitcoin key — the contract checks the signature itself, so they need no permission from us. If they never appear, it goes to the community."
            live={
              config
                ? config.originalSignerClaimed
                  ? "claimed — the original signer came back"
                  : `${fmtAmount(config.originalSignerAllocation, true)} still waiting`
                : null
            }
            clock={signerLeft ?? null}
          />
          <AllocRow
            who="The person who built this"
            window="12 months, drip-fed"
            body="Their tokens are not in a wallet. They sit inside the contract and trickle out daily across a year, after an initial waiting period. There is no button — not even for them — that releases the rest early."
            live={
              config
                ? config.devStreamCreated
                  ? `${fmtAmount(config.devAllocation, true)} locked in the contract`
                  : "not set up yet"
                : null
            }
          />
        </div>

        <Sub
          title="How you actually get paid"
          blurb="Three different shapes, and the words for them get used loosely everywhere else. Cumulative tokens received, against time."
        />
        <PayoutShapes />

        <Sub
          title="And what happens to the rest"
          blurb="Every deadline above has the same consequence when it passes."
        />
        <Figure
          caption="Unclaimed allocations, forfeited staking escrow, trading fees and donations all end in the same place. There is no path back to the team — the contract has no instruction that would allow one."
        >
          <BucketFlowDiagram />
        </Figure>

        <div className="l-rule">
          <span className="l-micro">The rule that covers all four</span>
          <p className="l-rule-line">
            Anything nobody claims becomes rewards for the people who stake.
          </p>
          <p className="l-rule-body">
            Influencers who never turn up. Legacy Buddy holders who never come back. The
            2014 reserve if nobody ever proves it. Tokens given up by people who
            break a staking lock early. All of it goes to the same place, and
            none of it can come back to the team — there is no instruction in the
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
              ? "Couldn't read it — check yourself"
              : upgrade.immutable
              ? "No — the code is permanent"
              : "Not yet — happens at launch"
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
              rewritten — which is why "our contract is locked" is close to
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
          hint="Look at the line that says Authority. If it reads none, the code can never change again — not by us, not by anyone."
          figure={<AuthorityDiagram />}
          figureCaption="This is the check almost nobody performs, and it is the one that decides whether any other promise on this page is enforceable."
        />

        <Proof
          question="Could the team dump a huge bag on everyone?"
          answer={
            !chainReadable
              ? "Couldn't read it — check yourself"
              : config.devStreamCreated
              ? "No — locked for 12 months"
              : "Not set up yet"
          }
          tone={
            !chainReadable ? "unknown" : config.devStreamCreated ? "good" : "warn"
          }
          plain={
            <>
              This is exactly how the last coin died. Here the builder's tokens
              never touch a wallet they control — they sit in the contract and
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
              and get an identical answer — so the full holder list is published,
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
            body="Making the contract unchangeable also means that if there is a mistake in it, nobody can repair it — not us, not anyone, ever. A full rehearsal on a test network and an independent security review were the only two chances to catch one. We chose that anyway, because a contract someone can rewrite is a contract you have to trust someone about, and this community has already been asked to do that once."
          />
          <IndexRow
            when="Deadlines"
            title="Miss a claim window and it's gone."
            body="The windows are enforced by the contract. Nobody can make an exception, however good the reason."
          />
          <IndexRow
            when="Us"
            title="We can't steal it, but we can lose interest."
            body="The mechanism makes a rug impossible. It does not make us show up forever. That risk is real and we're not going to pretend otherwise — though the contract keeps running either way, and anyone at all can trigger the payouts, not just us."
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
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "unknown" | "plain";
  note: string;
}) {
  return (
    <div className="l-spec-cell">
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
  body: string;
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
  body: string;
  note: string;
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
      <p>{body}</p>
      {address && <code className="l-route-address">{address}</code>}
      <p className="l-route-note">{note}</p>
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
  window: win,
  body,
  live,
  clock,
}: {
  who: string;
  window: string;
  body: string;
  live: string | null;
  clock?: string | null;
}) {
  return (
    <div className="l-alloc-row">
      <div className="l-alloc-main">
        <h3>{who}</h3>
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
 * A plain question, a plain answer, and the command that settles it — folded
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
