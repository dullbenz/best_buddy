import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  INFLUENCER_PROOFS_URL,
  INFLUENCER_TERMS,
  OLD_HOLDER_PROOFS_URL,
  ORIGINAL_MESSAGE,
  ORIGINAL_SIGNER_DEADLINE,
  SNAPSHOT,
  btcTxUrl,
} from "../config";
import { countdown, fmtAmount, fmtDate } from "../format";
import { VERIFY_ANCHORS, goTo } from "../nav";
import { onRouteChange, parseLocation, pushRoute, replaceRoute } from "../router";
import { useClaimReceipts, useDistributor, useStream } from "../useDistributor";
import { useClaimLedger } from "../useClaimData";
import { ClaimTables } from "./ClaimTables";
import { ConnectToClaim, ForfeitNote, StreamExplainer, Verdict, useClock } from "./claimShared";

interface ProofEntry {
  address: string;
  amount: string;
  proof: string[];
}

type ProofFile = Record<string, ProofEntry>;

type ClaimTab = "overview" | "legacy" | "influencer" | "signer";

async function loadProofs(url: string): Promise<ProofFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  return res.json();
}

/**
 * The public side of the claims: who is owed what, on what terms, and how the
 * lists were built. Deliberately readable end to end without a wallet.
 *
 * Nothing on this page signs anything. Every action a wallet can take, from
 * claiming to withdrawing from a stream, lives on My Buddy, so a visitor is
 * never asked to plug a wallet into a page they are still deciding about, and
 * someone who is owed something is handed one place to do it all.
 */
export function Claims() {
  const { publicKey } = useWallet();
  const { config } = useDistributor();
  const { stream } = useStream(publicKey ?? null);
  const receipts = useClaimReceipts(publicKey ?? null);

  const [oldProofs, setOldProofs] = useState<ProofFile | null>(null);
  const [infProofs, setInfProofs] = useState<ProofFile | null>(null);

  const CLAIM_TABS: ClaimTab[] = ["overview", "legacy", "influencer", "signer"];
  const sectionFromUrl = (): ClaimTab => {
    const { section } = parseLocation(["claims"]);
    return (CLAIM_TABS as string[]).includes(section ?? "")
      ? (section as ClaimTab)
      : "overview";
  };

  const [tab, setTab] = useState<ClaimTab>(sectionFromUrl);
  /** Set once the reader picks a tab, so nothing moves under them after that. */
  const chosen = useRef(window.location.pathname.split("/").length > 2);

  // Back and forward move between sections too, not just between tabs.
  useEffect(() => onRouteChange(() => setTab(sectionFromUrl())), []);

  // "/claims/stream" was a real URL before the stream moved to My Buddy, so a
  // saved link lands where the stream actually is rather than on a shrug.
  useEffect(() => {
    if (parseLocation(["claims"]).section === "stream") goTo("my buddy");
  }, []);

  useEffect(() => {
    loadProofs(OLD_HOLDER_PROOFS_URL).then(setOldProofs).catch(() => setOldProofs({}));
    loadProofs(INFLUENCER_PROOFS_URL).then(setInfProofs).catch(() => setInfProofs({}));
  }, []);

  const ledger = useClaimLedger(oldProofs, infProofs);

  const address = publicKey?.toBase58() ?? null;
  const oldEntry = address ? oldProofs?.[address] : undefined;
  const infEntry = address ? infProofs?.[address] : undefined;

  /**
   * Open on the section that applies to this wallet.
   *
   * Landing an influencer on "this wallet is not in the snapshot" is a bad
   * first answer to give someone who is in fact owed something. Runs once, and
   * never after the reader has picked a tab themselves; a page that keeps
   * re-deciding where you are is worse than one that guesses wrong once.
   */
  useEffect(() => {
    if (chosen.current || !address || !oldProofs || !infProofs) return;
    chosen.current = true;
    const pick = oldProofs[address]
      ? "legacy"
      : infProofs[address]
        ? "influencer"
        : null;
    if (!pick) return;
    setTab(pick);
    // replace, not push: the reader did not navigate here, so Back should
    // still take them to wherever they actually came from.
    replaceRoute("claims", pick);
  }, [address, oldProofs, infProofs]);

  // Countdowns tick rather than freeze at first paint.
  const now = useClock();
  const oldLeft = config ? countdown(Number(config.oldHolderDeadline), now) : null;
  const infLeft = config ? countdown(Number(config.influencerDeadline), now) : null;

  /** One sentence and one button: the road from "you are owed" to "go do it". */
  const goClaim = (label: string) => (
    <button className="primary" onClick={() => goTo("my buddy")}>
      {label} <span aria-hidden="true">→</span>
    </button>
  );

  /**
   * Both bucket cards render whether or not a wallet is connected.
   *
   * What they say is the substance of the offer: who is owed what, and on
   * what terms. Hiding that behind a connect button asks people to plug a
   * wallet into a site before it has told them anything, which is exactly the
   * instinct this project should not be punishing.
   */
  const legacyCard = (
    <section className="card">
      <h2>Legacy Buddy holders</h2>
      <p className="muted">
        If you held the <strong>legacy</strong> token just before this rebirth was launched,
        then you have a share of the new token based on those holdings. <SnapshotMoment />
      </p>
      <p className="muted small">
        Paid in full the moment you claim. No lockup, no vesting, no strings.
      </p>

      {!publicKey ? (
        <ConnectToClaim question="Held the legacy $Buddy?" />
      ) : oldProofs === null ? (
        <p className="muted">Checking the snapshot…</p>
      ) : receipts.oldHolder ? (
        <Verdict tone="done" heading="Claimed. This allocation has been paid out.">
          <p>
            <strong>{fmtAmount(receipts.oldHolder.amount)}</strong> was sent to
            this wallet on {fmtDate(receipts.oldHolder.claimedAt)}. The contract
            records one receipt per wallet and will not pay a second time, so
            there is nothing left to do here.
          </p>
        </Verdict>
      ) : oldEntry ? (
        <Verdict tone="hit" heading="This wallet is in the legacy $Buddy holder snapshot.">
          <p>
            It is owed <strong>{fmtAmount(oldEntry.amount)}</strong>.{" "}
            {oldLeft ? `The claim window closes in ${oldLeft}.` : "The window has closed."}{" "}
            Claiming happens on <strong>My Buddy</strong>, the page for
            everything this wallet can do.
          </p>
          {oldLeft ? goClaim("Claim it on My Buddy") : null}
        </Verdict>
      ) : (
        <Verdict tone="miss" heading="This wallet is not in the legacy $Buddy holder snapshot.">
          <p>
            Either it held no $Buddy at the snapshot moment, or it was excluded.{" "}
            <span className="mono">excluded.csv</span> below names every excluded
            address and the reason for it, and{" "}
            <span className="mono">holders.csv</span> names everyone who is in:-
            so you can settle which of the two it was rather than ask us.
          </p>
        </Verdict>
      )}

      <SnapshotFiles
        files={SNAPSHOT.legacy}
        foot={
          <>
            The list is built only from public Solana history, so anyone can
            rebuild it and get the same answer. Rebuild the fingerprint from{" "}
            <span className="mono">holders.csv</span> and it must equal the one
            stored on chain. The <strong>Verify</strong> tab has the
            command. Publishing only the eligible addresses would let us drop
            anyone we liked without it showing, so the exclusions are published
            too, each with a reason you can disagree with.
          </>
        }
      />

      <ForfeitNote label="If someone doesn't claim">
        Every allocation left unclaimed when the 30-day window closes becomes
        staking rewards for the community. There is no instruction that returns
        it to the team, and no upgrade authority to change it.
      </ForfeitNote>
    </section>
  );

  const influencerCard = (
    <section className="card">
      <h2>Influencer allocation</h2>
      <p className="muted">
        A named list of KOLs we've reached out to, to promote and talk about the project publicly.
        Claiming pays <strong>nothing up front</strong>:- the tokens are
        released gradually across 30 days instead of arriving in one lump.
      </p>
      <p className="muted small">
        To be exact about what that does and does not do: it removes the
        incentive to claim and dump on day one, and it means anyone promoting
        this is still holding while they do it. It is <em>not</em> a
        performance condition. The contract cannot tell whether they posted,
        and there is no instruction that cancels a stream:- so someone who
        claims and never says a word still collects the full amount by day 30.
        The commitment below is a matter of their word and reputation, not
        of code.
      </p>
      <p className="muted small">
        The window is 72 hours from launch. Everyone on this list was told in
        writing to disclose that they were compensated.
      </p>

      <StreamExplainer />

      <details className="terms">
        <summary>The terms every influencer signs before claiming</summary>
        <pre className="terms-body">{INFLUENCER_TERMS}</pre>
      </details>

      {!publicKey ? (
        <ConnectToClaim question="On the influencer list?" />
      ) : infProofs === null ? (
        <p className="muted">Checking the list…</p>
      ) : receipts.influencer ? (
        <Verdict tone="done" heading="Claimed. The stream is open.">
          <p>
            <strong>{fmtAmount(receipts.influencer.amount)}</strong> was
            committed to this wallet on {fmtDate(receipts.influencer.claimedAt)}
            , and is releasing across 30 days from then. Nothing further is
            claimed here. Withdraw from it on <strong>My Buddy</strong> whenever
            you like.
          </p>
          {goClaim("Open My Buddy")}
        </Verdict>
      ) : infEntry ? (
        <Verdict tone="hit" heading="This wallet is on the influencer list.">
          <p>
            It is allocated <strong>{fmtAmount(infEntry.amount)}</strong>.{" "}
            {infLeft ? `You have ${infLeft} left to claim.` : "The 72-hour window has closed."}{" "}
            Signing the terms and claiming both happen on{" "}
            <strong>My Buddy</strong>.
          </p>
          {infLeft ? goClaim("Claim it on My Buddy") : null}
        </Verdict>
      ) : (
        <Verdict tone="miss" heading="This wallet is not on the influencer list.">
          <p>
            The list is published below in full, so you can read every username and wallet address on
            it to verify whether you should have a claim or not.
          </p>
        </Verdict>
      )}

      <SnapshotFiles
        files={SNAPSHOT.influencers}
        foot={
          <>
            This list is chosen by hand rather than derived from chain, so
            there is no way to re-derive it, which is exactly why it is
            published in full. Rebuild the fingerprint from{" "}
            <span className="mono">influencers.csv</span> and it must equal the
            one stored on chain, so the list you are reading is
            provably the list the contract pays.
          </>
        }
      />

      <ForfeitNote label="If someone doesn't claim">
        Everything left unclaimed when the 72-hour window closes goes to the
        stakers, not to us, and it streams to them over the same 30 days it
        would have streamed to the influencer. An expired window never turns
        into a lump sum for anyone.
      </ForfeitNote>
    </section>
  );

  /**
   * One section at a time, rather than all of them stacked.
   *
   * Each bucket carries a lot of necessary explanation (what a stream is, what
   * the fingerprint proves, what happens to what nobody claims), and stacking
   * them made the page long enough that the thing a visitor actually came for
   * was several screens down. These are alternatives, not a sequence: almost
   * nobody is both a legacy holder and an influencer, so showing both at once
   * mostly showed people a card that did not apply to them.
   *
   * The dot marks a section this wallet has something in, so the right tab is
   * findable without opening each one.
   */
  const sections: Array<{
    id: ClaimTab;
    label: string;
    marked: boolean;
    body: ReactNode;
  }> = [
    {
      id: "overview",
      label: "Overview",
      marked: false,
      body: (
        <>
          {stream && (
            <StreamShortcut onOpen={() => goTo("my buddy")} />
          )}
          <AddressLookup oldProofs={oldProofs} infProofs={infProofs} />
          <ClaimTables
            legacy={ledger.legacy}
            influencers={ledger.influencers}
            loading={ledger.loading}
            error={ledger.error}
            statusKnown={ledger.statusKnown}
            highlight={address}
          />
        </>
      ),
    },
    {
      id: "legacy",
      label: "Legacy holder",
      marked: !!oldEntry && !receipts.oldHolder,
      body: legacyCard,
    },
    {
      id: "influencer",
      label: "Influencer",
      marked: !!infEntry && !receipts.influencer,
      body: influencerCard,
    },
    {
      id: "signer",
      label: "2014 signer",
      marked: false,
      body: <SignerInfo config={config} connected={!!publicKey} />,
    },
  ];

  const active = sections.find((t) => t.id === tab) ?? sections[0];

  return (
    <div className="stack">
      <nav className="subtabs" aria-label="Claims sections">
        {sections.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === active.id ? "subtab is-active" : "subtab"}
            aria-current={t.id === active.id ? "page" : undefined}
            onClick={() => {
              chosen.current = true;
              setTab(t.id);
              pushRoute("claims", t.id);
            }}
          >
            {t.label}
            {t.marked && (
              <span className="subtab-dot" aria-label="has something to claim" />
            )}
          </button>
        ))}
      </nav>

      {publicKey && !config ? <div className="card">Loading…</div> : active.body}
    </div>
  );
}

/**
 * The exact moment the holder list was frozen.
 *
 * Until the snapshot is actually taken these render as visible blanks rather
 * than a plausible date. A confident but wrong timestamp on the one fact that
 * decides who gets paid would be worse than an obvious gap.
 */
function SnapshotMoment() {
  // Not toUTCString(): that renders "GMT", which is a different label for the
  // same offset and invites the question of whether it is the same thing.
  // Every other timestamp on the site says UTC, so this one does too.
  const when = SNAPSHOT.takenAt
    ? fmtDate(new Date(SNAPSHOT.takenAt).getTime() / 1000)
    : null;
  const slot = SNAPSHOT.slot;

  return (
    <>
      A snapshot of every holder of the legacy token was taken just before the
      launch of this rebirthed token i.e at{" "}
      {when ? (
        <strong>{when}</strong>
      ) : (
        <span className="placeholder">snapshot date and time</span>
      )}
      , covering all holders of the legacy token at block number{" "}
      {slot ? (
        <strong>{slot.toLocaleString()}</strong>
      ) : (
        <span className="placeholder">snapshot block number</span>
      )}
      . Nothing you do now can change what you can claim.
    </>
  );
}

/**
 * Check any address without connecting a wallet.
 *
 * The snapshot is a published fact, so requiring a wallet connection to read it
 * was a barrier with nothing behind it, and a bad one for this audience
 * specifically, who have been rugged once and are not keen to connect a wallet
 * to a site they are still deciding about. It also lets someone check on behalf
 * of a friend, or check a cold wallet from a hot one.
 *
 * Read-only by construction: this only looks up a local JSON file. Claiming
 * still needs the wallet, and the result says so.
 */
function AddressLookup({
  oldProofs,
  infProofs,
}: {
  oldProofs: ProofFile | null;
  infProofs: ProofFile | null;
}) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<
    | null
    | { kind: "invalid" }
    | { kind: "loading" }
    | { kind: "none"; address: string }
    | { kind: "found"; address: string; old?: string; inf?: string }
  >(null);

  function check() {
    const value = input.trim();
    if (!value) return;

    // Validate as a real Solana address rather than by length: a typo'd
    // base58 string of the right length would otherwise report "nothing
    // found", which reads as a verdict when it is actually a bad input.
    let address: string;
    try {
      address = new PublicKey(value).toBase58();
    } catch {
      setResult({ kind: "invalid" });
      return;
    }

    if (!oldProofs || !infProofs) {
      setResult({ kind: "loading" });
      return;
    }

    const old = oldProofs[address]?.amount;
    const inf = infProofs[address]?.amount;
    setResult(old || inf ? { kind: "found", address, old, inf } : { kind: "none", address });
  }

  return (
    <section className="card">
      <h2>Check any address</h2>
      <p className="muted">
        The claimants snapshots are public, so you do not need to connect anything to read
        it. Paste a wallet address and this tells you what it is owed. Claiming
        still requires that wallet's signature.
      </p>

      <div className="form-row">
        <input
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="Solana wallet address"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
        />
        <button className="primary" disabled={!input.trim()} onClick={check}>
          Check
        </button>
      </div>

      {result?.kind === "invalid" && (
        <p className="muted small">
          That is not a valid Solana address. Check for a missing or extra
          character. This is not a result, it is a typo.
        </p>
      )}

      {result?.kind === "loading" && (
        <p className="muted small">Still loading the published lists. Try again in a moment.</p>
      )}

      {result?.kind === "none" && (
        <div className="note note-miss">
          <span className="mono small">{result.address}</span>
          <div className="lookup-hits">
            <div>
              <strong>Nothing to claim.</strong> This address is on neither
              list.
            </div>
          </div>
          <div className="note-cta">
            It held no $Buddy at the snapshot moment, it is not an influencer,
            or it was excluded, and every exclusion is published with its
            reason, so you can settle which.
          </div>
        </div>
      )}

      {result?.kind === "found" && (
        <div className="note">
          <span className="mono small">{result.address}</span>
          <div className="lookup-hits">
            {result.old && (
              <div>
                <strong>{fmtAmount(result.old)}</strong> as a Legacy Buddy
                holder, paid in full on claim, no lockup.
              </div>
            )}
            {result.inf && (
              <div>
                <strong>{fmtAmount(result.inf)}</strong> as an influencer,
                released in a stream across 30 days, nothing up front.
              </div>
            )}
          </div>
          <div className="note-cta">
            Connect this wallet and claim it on My Buddy. Nobody else can claim
            on its behalf.
          </div>
        </div>
      )}
    </section>
  );
}

type FileStatus = "checking" | "published" | "pending";

/**
 * Whether each published file is actually there.
 *
 * A single-page app answers 200 with index.html for any path that does not
 * exist, so a link to a file that has not been generated yet silently "works"
 * and hands the visitor a copy of the website instead. On a page whose whole
 * argument is "check this yourself", that is the worst available failure, so
 * probe the content type and say plainly when a file is not published yet.
 */
function useFileStatus(files: ReadonlyArray<{ url: string }>) {
  const [status, setStatus] = useState<Record<string, FileStatus>>({});

  useEffect(() => {
    let live = true;
    Promise.all(
      files.map(async (f) => {
        try {
          const res = await fetch(f.url, { method: "HEAD" });
          const type = res.headers.get("content-type") ?? "";
          const ok = res.ok && !type.includes("text/html");
          return [f.url, ok ? "published" : "pending"] as const;
        } catch {
          return [f.url, "pending"] as const;
        }
      })
    ).then((entries) => {
      if (live) setStatus(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [files]);

  return status;
}

/**
 * Links to the raw list behind a bucket.
 *
 * "Check the published list" is only meaningful if the list is one click away,
 * so both actions are offered: view it in the browser to settle a question now,
 * download it to rebuild the Merkle tree and check the root yourself.
 */
function SnapshotFiles({
  files,
  foot,
}: {
  files: ReadonlyArray<{ name: string; url: string; description: string }>;
  foot: ReactNode;
}) {
  const status = useFileStatus(files);
  const verifyHere = () => goTo("verify", VERIFY_ANCHORS.snapshotReproducible);
  const allPublished = files.every((f) => status[f.url] === "published");

  return (
    <div className="files">
      <div className="files-head">
        Published
        <span className="files-note">
          served from this domain, committed in the public repository, and both
          matching the fingerprint stored in the contract. Editing a single
          digit in these files breaks that fingerprint, and the contract pays
          against the fingerprint, not against whatever is written here.
          <button type="button" className="files-verify" onClick={verifyHere}>
            Verify this yourself <span aria-hidden="true">→</span>
          </button>
        </span>
      </div>

      {files.map((f) => (
        <div className="file-row" key={f.name}>
          <div className="file-meta">
            <span className="mono file-name">{f.name}</span>
            <span className="file-desc">{f.description}</span>
          </div>
          <div className="file-actions">
            {status[f.url] === "published" ? (
              <>
                <a href={f.url} target="_blank" rel="noreferrer noopener">
                  view
                </a>
                <a href={f.url} download>
                  download
                </a>
              </>
            ) : (
              <span className="file-pending">
                {status[f.url] === "pending" ? "not published yet" : "…"}
              </span>
            )}
          </div>
        </div>
      ))}

      <p className="file-foot">
        {allPublished ? null : (
          <>
            These appear the moment the snapshot is taken, just before launch;
            publishing them earlier would mean publishing a list that is still
            going to change.{" "}
          </>
        )}
        {foot}
      </p>
    </div>
  );
}

/**
 * The stream, surfaced on Overview so it is not hidden behind a tab.
 *
 * A single line, not a card: one fact and one exit, with the whole row as the
 * target. The stream itself lives on My Buddy with everything else the wallet
 * can act on, so this is a signpost rather than a summary, and it does not
 * repeat numbers that page keeps live.
 */
function StreamShortcut({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="stream-shortcut" onClick={onOpen}>
      <span className="shortcut-text">
        This wallet has an open stream.
      </span>
      <span className="shortcut-go">
        Open it on My Buddy <span aria-hidden="true">&rarr;</span>
      </span>
    </button>
  );
}

/**
 * Bucket 4a, explained: whoever holds the Bitcoin key that signed the 2014
 * message. The claim itself, with its two-step signature flow, lives on
 * My Buddy like every other action; this page carries the story and the
 * current state, which are what a visitor without the key came to read.
 */
function SignerInfo({ config, connected }: { config: any; connected: boolean }) {
  const left = countdown(ORIGINAL_SIGNER_DEADLINE);
  const claimed = config?.originalSignerClaimed === true;
  const swept = config?.originalSignerSwept === true;

  return (
    <section className="card">
      <h2>The 2014 signer</h2>
      <p className="muted">
        The message this coin is named after was written onto the Bitcoin
        blockchain in 2014 by someone who has never been identified. A share is
        held for them, and the only way to take it is to prove control of the
        key that signed it.{" "}
        <a
          href={btcTxUrl(ORIGINAL_MESSAGE.txid)}
          target="_blank"
          rel="noreferrer noopener"
        >
          The transaction <span aria-hidden="true">&#8599;</span>
        </a>
      </p>
      <p className="muted small">
        Nobody can approve or refuse this, not us and not anyone. The contract
        recovers the public key from the signature and compares it to the one
        frozen in its config. It either matches or it does not.
      </p>

      {swept ? (
        <Verdict tone="done" heading="Unclaimed, and now gone to the stakers.">
          <p>
            The deadline passed without anyone proving control of the key, so
            this allocation became staking rewards for the community.
          </p>
        </Verdict>
      ) : claimed ? (
        <Verdict tone="done" heading="Claimed. The original signer came back.">
          <p>
            Somebody proved control of the 2014 key, and their stream is open.
            Nothing further can be claimed here.
          </p>
        </Verdict>
      ) : !connected ? (
        <ConnectToClaim question="Do you hold the 2014 key?" />
      ) : (
        <div className="claim-cta">
          <span>
            Hold the key? The claim is a two-step signature flow, and it lives
            with every other wallet action.
          </span>
          <button className="primary" onClick={() => goTo("my buddy")}>
            Prove it on My Buddy <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      <ForfeitNote label="If nobody claims">
        This allocation is held until {fmtDate(ORIGINAL_SIGNER_DEADLINE)},
        and pays as a 12-month stream whoever ends up with it. If the key
        signs, it streams to the signer. If it never does, it streams to the
        community instead: same amount, same year-long schedule, and never
        back to the team. Forfeiting a stream does not turn it into a lump
        sum for anyone.{left ? ` ${left} remain.` : ""}
      </ForfeitNote>
    </section>
  );
}
