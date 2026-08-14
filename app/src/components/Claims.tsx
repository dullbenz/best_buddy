import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useEffect, useState, type ReactNode } from "react";
import {
  INFLUENCER_PROOFS_URL,
  OLD_HOLDER_PROOFS_URL,
  INFLUENCER_TERMS,
  SEEDS,
  SNAPSHOT,
  TERMS_API,
  pda,
} from "../config";
import { countdown, fmtTokens } from "../format";
import { useDistributor, useStream } from "../useDistributor";
import { useProgram } from "../useProgram";

interface ProofEntry {
  address: string;
  amount: string;
  proof: string[];
}

type ProofFile = Record<string, ProofEntry>;

async function loadProofs(url: string): Promise<ProofFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  return res.json();
}

export function Claims() {
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, refresh } = useDistributor();
  const { stream } = useStream(publicKey ?? null);

  const [oldProofs, setOldProofs] = useState<ProofFile | null>(null);
  const [infProofs, setInfProofs] = useState<ProofFile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Base58 of the wallet's signature over INFLUENCER_TERMS. Gates the claim.
  //
  // Seeded from localStorage so someone who signs, then reloads or comes back
  // later, is not asked to sign the same terms twice. The register is keyed by
  // address, so a re-signature would be a no-op server-side anyway.
  const [termsSig, setTermsSig] = useState<string | null>(() =>
    publicKey ? localStorage.getItem(`buddy.terms.${publicKey.toBase58()}`) : null
  );

  useEffect(() => {
    loadProofs(OLD_HOLDER_PROOFS_URL).then(setOldProofs).catch(() => setOldProofs({}));
    loadProofs(INFLUENCER_PROOFS_URL).then(setInfProofs).catch(() => setInfProofs({}));
  }, []);

  const address = publicKey?.toBase58() ?? null;
  const oldEntry = address ? oldProofs?.[address] : undefined;
  const infEntry = address ? infProofs?.[address] : undefined;
  const now = Date.now() / 1000;
  const oldLeft = config ? countdown(Number(config.oldHolderDeadline), now) : null;
  const infLeft = config ? countdown(Number(config.influencerDeadline), now) : null;

  /** Make sure the wallet has an ATA for the token before anything pays into it. */
  async function ensureAta(): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(config!.rewardMint, publicKey!);
    const info = await connection.getAccountInfo(ata);
    if (!info) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(publicKey!, ata, publicKey!, config!.rewardMint)
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
    }
    return ata;
  }

  async function claimOldHolder() {
    if (!program || !oldEntry) return;
    setBusy(true);
    setStatus(null);
    try {
      const destination = await ensureAta();
      const sig = await program.methods
        .claimOldHolder(
          new BN(oldEntry.amount),
          oldEntry.proof.map((p) => Array.from(Buffer.from(p, "hex")))
        )
        .accountsPartial({
          claimant: publicKey!,
          config: pda([SEEDS.config]),
          receipt: pda([SEEDS.oldClaim, publicKey!.toBuffer()]),
          vault: pda([SEEDS.vault]),
          destination,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`Claimed. Transaction ${sig}`);
      refresh();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sign the published terms and record the signature publicly.
   *
   * Not a transaction: no fee, nothing on chain. The wallet shows the full
   * terms text, so what is being agreed to is visible at signing time rather
   * than hidden behind a hash.
   */
  async function signTerms() {
    if (!signMessage || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const raw = await signMessage(new TextEncoder().encode(INFLUENCER_TERMS));
      const encoded = bs58.encode(raw);
      const signer = publicKey.toBase58();

      setTermsSig(encoded);
      localStorage.setItem(`buddy.terms.${signer}`, encoded);

      // Publishing is best-effort on purpose. The register is a transparency
      // aid, not a gate — refusing to let someone claim their allocation
      // because our own server was down would be the wrong failure.
      try {
        const res = await fetch(TERMS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: signer, signature: encoded }),
        });
        setStatus(
          res.ok
            ? "Terms signed and published to the public register. You can claim now."
            : "Terms signed. The public register could not be reached, so it was not recorded there — you can still claim."
        );
      } catch {
        setStatus(
          "Terms signed. The public register could not be reached, so it was not recorded there — you can still claim."
        );
      }
    } catch (e: any) {
      setStatus(`Not signed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function claimInfluencer() {
    if (!program || !infEntry) return;
    setBusy(true);
    setStatus(null);
    try {
      const sig = await program.methods
        .claimInfluencer(
          new BN(infEntry.amount),
          infEntry.proof.map((p) => Array.from(Buffer.from(p, "hex")))
        )
        .accountsPartial({
          claimant: publicKey!,
          config: pda([SEEDS.config]),
          receipt: pda([SEEDS.influencerClaim, publicKey!.toBuffer()]),
          stream: pda([SEEDS.stream, publicKey!.toBuffer()]),
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`Stream opened. Transaction ${sig}`);
      refresh();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function withdrawStream() {
    if (!program) return;
    setBusy(true);
    setStatus(null);
    try {
      const destination = await ensureAta();
      const sig = await program.methods
        .streamWithdraw()
        .accountsPartial({
          beneficiary: publicKey!,
          config: pda([SEEDS.config]),
          stream: pda([SEEDS.stream, publicKey!.toBuffer()]),
          vault: pda([SEEDS.vault]),
          destination,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setStatus(`Withdrawn. Transaction ${sig}`);
      refresh();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const vested = stream
    ? (() => {
        const total = Number(stream.total);
        const start = Number(stream.start);
        const end = Number(stream.end);
        const cliff = Number(stream.cliff);
        if (now < cliff) return 0;
        if (now >= end) return total;
        return (total * (now - start)) / (end - start);
      })()
    : 0;
  const withdrawable = stream ? Math.max(0, vested - Number(stream.withdrawn)) : 0;

  /**
   * Both bucket cards render whether or not a wallet is connected.
   *
   * What they say is the substance of the offer — who is owed what, and on
   * what terms. Hiding that behind a connect button asks people to plug a
   * wallet into a site before it has told them anything, which is exactly the
   * instinct this project should not be punishing.
   */
  const legacyCard = (
    <section className="card">
      <h2>Legacy Buddy holders</h2>
      <p className="muted">
        If you held the <strong>legacy</strong> Buddy token when its creator
        walked away, this is your restitution. <SnapshotMoment />
      </p>
      <p className="muted small">
        Paid in full the moment you claim. No lockup, no vesting, no strings.
      </p>

      {!publicKey ? (
        <ConnectToClaim question="Held the legacy Buddy?" />
      ) : oldProofs === null ? (
        <p className="muted">Checking the snapshot…</p>
      ) : oldEntry ? (
        <Verdict tone="hit" heading="This wallet is in the snapshot.">
          <p>
            It is owed <strong>{fmtTokens(oldEntry.amount)}</strong> tokens.{" "}
            {oldLeft ? `The window closes in ${oldLeft}.` : "The window has closed."}
          </p>
          <button className="primary" disabled={busy || !oldLeft} onClick={claimOldHolder}>
            {oldLeft ? "Claim" : "Window closed"}
          </button>
        </Verdict>
      ) : (
        <Verdict tone="miss" heading="This wallet is not in the snapshot.">
          <p>
            Either it held no Buddy at the snapshot moment, or it was excluded.{" "}
            <span className="mono">excluded.csv</span> below names every excluded
            address and the reason for it, and{" "}
            <span className="mono">holders.csv</span> names everyone who is in —
            so you can settle which of the two it was rather than ask us.
          </p>
        </Verdict>
      )}

      <SnapshotFiles
        files={SNAPSHOT.legacy}
        foot={
          <>
            The list is built only from public Solana history, so anyone can
            rebuild it and get the same answer. Rebuild the tree from{" "}
            <span className="mono">holders.csv</span> and its root must equal
            the one stored on chain — the <strong>Verify</strong> tab has the
            command. Publishing only the eligible addresses would let us drop
            anyone we liked without it showing, so the exclusions are published
            too, each with a reason you can disagree with.
          </>
        }
      />

      <ForfeitNote label="If nobody claims">
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
        A named list of people asked to talk about the project publicly.
        Claiming pays <strong>nothing up front</strong> — the tokens are
        released gradually across 30 days instead of arriving in one lump.
      </p>
      <p className="muted small">
        To be exact about what that does and does not do: it removes the
        incentive to claim and dump on day one, and it means anyone promoting
        this is still holding while they do it. It is <em>not</em> a
        performance condition. The contract cannot tell whether you posted,
        and there is no instruction that cancels a stream — so someone who
        claims and never says a word still collects the full amount by day 30.
        The commitment below is a matter of your word and your reputation, not
        of code.
      </p>
      <p className="muted small">
        The window is 72 hours from launch. Everyone on this list was told in
        writing to disclose that they were compensated.
      </p>

      <StreamExplainer />

      {!publicKey ? (
        <ConnectToClaim question="On the influencer list?" />
      ) : infProofs === null ? (
        <p className="muted">Checking the list…</p>
      ) : infEntry ? (
        <>
          <Verdict tone="hit" heading="This wallet is on the influencer list.">
            <p>
              It is allocated <strong>{fmtTokens(infEntry.amount)}</strong>{" "}
              tokens.{" "}
              {infLeft ? `You have ${infLeft} left to claim.` : "The 72-hour window has closed."}
            </p>
          </Verdict>

          <details className="terms" open={!termsSig}>
            <summary>The terms you are agreeing to</summary>
            <pre className="terms-body">{INFLUENCER_TERMS}</pre>
          </details>

          {termsSig ? (
            <p className="muted small">
              ✓ Terms signed by this wallet, and added to the{" "}
              <a href={TERMS_API} target="_blank" rel="noreferrer noopener">
                public register
              </a>
              .
            </p>
          ) : (
            <p className="muted small">
              Sign the terms before claiming. This costs nothing and is not a
              transaction; it is a message signed with your key, proving these
              terms were shown and accepted. Your wallet will display the
              full text, so you can read exactly what you are agreeing to.
            </p>
          )}

          <div className="button-row">
            {!termsSig && (
              <button disabled={busy || !infLeft || !signMessage} onClick={signTerms}>
                {signMessage ? "Sign the terms" : "Wallet cannot sign messages"}
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !infLeft || !termsSig}
              onClick={claimInfluencer}
            >
              {infLeft ? "Claim and open stream" : "Window closed"}
            </button>
          </div>
        </>
      ) : (
        <Verdict tone="miss" heading="This wallet is not on the influencer list.">
          <p>
            The list is published below in full, so you can read every name on
            it rather than wonder whether yours was left off quietly.
          </p>
        </Verdict>
      )}

      <SnapshotFiles
        files={SNAPSHOT.influencers}
        foot={
          <>
            This list is chosen by hand rather than derived from chain, so
            there is no way to re-derive it — which is exactly why it is
            published in full. Rebuild the tree from{" "}
            <span className="mono">influencers.csv</span> and its root must
            equal the one stored on chain, so the list you are reading is
            provably the list the contract pays.
          </>
        }
      />

      <ForfeitNote label="If nobody claims">
        Everything left unclaimed when the 72-hour window closes becomes staking
        rewards — it goes to the stakers, not to us.
      </ForfeitNote>
    </section>
  );

  // The lookup leads when there is no wallet: checking is what a stranger can
  // do straight away, and connecting is the thing they are still deciding
  // about. There is no standalone connect card — each bucket carries its own
  // prompt, so a third one would just be the same button asked for twice.
  if (!publicKey) {
    return (
      <div className="stack">
        <AddressLookup oldProofs={oldProofs} infProofs={infProofs} />
        {legacyCard}
        {influencerCard}
      </div>
    );
  }

  if (!config) return <div className="card">Loading…</div>;

  return (
    <div className="stack">
      {legacyCard}
      {influencerCard}

      {stream && (
        <section className="card">
          <h2>Your stream</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{fmtTokens(stream.total)}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtTokens(stream.withdrawn)}</span>
              <span className="stat-label">Withdrawn</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtTokens(BigInt(Math.floor(withdrawable)))}</span>
              <span className="stat-label">Available now</span>
            </div>
          </div>
          <button className="primary" disabled={busy || withdrawable < 1} onClick={withdrawStream}>
            Withdraw available
          </button>
        </section>
      )}

      <AddressLookup oldProofs={oldProofs} infProofs={infProofs} />

      {status && <div className="card status">{status}</div>}
    </div>
  );
}

/**
 * The way in, at the end of each bucket card.
 *
 * Opens the wallet picker rather than re-implementing the header's button, so
 * there is one wallet flow on the page and not two that can disagree.
 */
function ConnectToClaim({ question }: { question: string }) {
  const { setVisible } = useWalletModal();
  return (
    <div className="claim-cta">
      <span>{question} Connect the wallet to find out.</span>
      <button className="primary" onClick={() => setVisible(true)}>
        Connect wallet
      </button>
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
  const when = SNAPSHOT.takenAt ? new Date(SNAPSHOT.takenAt).toUTCString() : null;
  const slot = SNAPSHOT.slot;

  return (
    <>
      A snapshot of every holder of the legacy token was taken just before the
      launch of the reborn i.e at{" "}
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
      . Nothing you do now can change what you are owed.
    </>
  );
}

/**
 * The answer to "does this wallet have anything", boxed.
 *
 * This is what the visitor came for, and it was a paragraph of muted body text
 * indistinguishable from the explanation around it — a "no" that scrolled past
 * unread. It is the one thing on the card addressed to them personally, so it
 * gets the only strong border on the card.
 */
function Verdict({
  tone,
  heading,
  children,
}: {
  tone: "hit" | "miss";
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className={`verdict verdict-${tone}`} role="status">
      <strong className="verdict-head">{heading}</strong>
      {children}
    </div>
  );
}

/**
 * What happens to everything nobody claims.
 *
 * A standing rule rather than news, so it reads as a specification footnote
 * instead of competing with the verdict above it for the same attention. The
 * fact still matters — it is the difference between a forfeited allocation
 * going to the community and going back to the team — but it is the same fact
 * on every visit, and it should not shout on every visit.
 */
function ForfeitNote({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="card-foot">
      <span className="card-foot-label">{label}</span>
      {children}
    </p>
  );
}

/**
 * Check any address without connecting a wallet.
 *
 * The snapshot is a published fact, so requiring a wallet connection to read it
 * was a barrier with nothing behind it — and a bad one for this audience
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
        The snapshot is public, so you do not need to connect anything to read
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
          character — this is not a result, it is a typo.
        </p>
      )}

      {result?.kind === "loading" && (
        <p className="muted small">Still loading the published lists — try again in a moment.</p>
      )}

      {result?.kind === "none" && (
        <p className="muted small">
          <span className="mono">{result.address}</span> is not on either list.
          It held no Buddy at the snapshot moment, it is not an influencer, or
          it was excluded — and every exclusion is published with its reason.
        </p>
      )}

      {result?.kind === "found" && (
        <div className="note">
          <span className="mono small">{result.address}</span>
          <div className="lookup-hits">
            {result.old && (
              <div>
                <strong>{fmtTokens(result.old)}</strong> as a Legacy Buddy
                holder — paid in full on claim, no lockup.
              </div>
            )}
            {result.inf && (
              <div>
                <strong>{fmtTokens(result.inf)}</strong> as an influencer —
                released across 30 days, nothing up front.
              </div>
            )}
          </div>
          <div className="note-cta">
            Connect this wallet to claim. Nobody else can claim on its behalf.
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
 * argument is "check this yourself", that is the worst available failure — so
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
  const allPublished = files.every((f) => status[f.url] === "published");

  return (
    <div className="files">
      <div className="files-head">
        Published — and what published means
        <span className="files-note">
          served from this domain, and committed in the public repository. Two
          copies of the same bytes, so a list quietly edited here would stop
          matching the one on GitHub.
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
            These appear the moment the snapshot is taken, just before launch —
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
 * What a "30-day stream" actually is, in mechanical terms.
 *
 * People reasonably assume a stream is a promise someone keeps. It is not —
 * it is arithmetic in an account nobody can edit, so it is worth showing the
 * arithmetic.
 */
function StreamExplainer() {
  return (
    <div className="note">
      <strong>What "released over 30 days" actually means.</strong> Claiming does
      not send you tokens. It creates a <em>stream account</em> holding four
      numbers: the total, the start time, the end time, and how much you have
      already withdrawn.
      <br />
      Whenever you press withdraw, the contract works out how much time has
      passed as a fraction of the 30 days, multiplies that by your total,
      subtracts what you already took, and sends the difference. After ten days
      you can take about a third; after thirty, all of it.
      <br />
      Withdrawing is a normal transaction you send whenever you like — daily,
      once at the end, or never. Nothing is automatic and nothing expires: a
      matured stream stays yours indefinitely.
      <br />
      <span className="muted">
        The tokens stay in the contract's vault until each withdrawal, and no
        instruction exists to release them faster — not for you, not for us. The
        stream is keyed to your wallet, so nobody else can withdraw it. Equally,
        there is no instruction to cancel or claw one back: once opened, it runs
        to completion whatever anyone thinks of you afterwards.
      </span>
    </div>
  );
}
