import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useEffect, useState } from "react";
import {
  INFLUENCER_PROOFS_URL,
  OLD_HOLDER_PROOFS_URL,
  INFLUENCER_TERMS,
  SEEDS,
  TERMS_API,
  SNAPSHOT_FILES,
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

  if (!publicKey) {
    return (
      <div className="card">
        <h2>Claims</h2>
        <p className="muted">
          Connect a wallet to see whether it has anything to claim. Nothing is
          sent anywhere just by connecting.
        </p>
      </div>
    );
  }
  if (!config) return <div className="card">Loading…</div>;

  const address = publicKey.toBase58();
  const oldEntry = oldProofs?.[address];
  const infEntry = infProofs?.[address];
  const now = Date.now() / 1000;
  const oldLeft = countdown(Number(config.oldHolderDeadline), now);
  const infLeft = countdown(Number(config.influencerDeadline), now);

  /** Make sure the wallet has an ATA for the token before anything pays into it. */
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
      const address = publicKey.toBase58();

      setTermsSig(encoded);
      localStorage.setItem(`buddy.terms.${address}`, encoded);

      // Publishing is best-effort on purpose. The register is a transparency
      // aid, not a gate — refusing to let someone claim their allocation
      // because our own server was down would be the wrong failure.
      try {
        const res = await fetch(TERMS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, signature: encoded }),
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

  return (
    <div className="stack">
      <section className="card">
        <h2>Legacy Buddy holders</h2>
        <p className="muted">
          If you held the <strong>original</strong> Buddy token when its creator
          walked away, this is your restitution. A snapshot of every holder was
          taken at a fixed moment in the past, so nothing you do now can change
          what you are owed — and buying the old token today earns nothing.
        </p>
        <p className="muted small">
          Paid in full the moment you claim. No lockup, no vesting, no strings:
          sell it the same minute if you want to.
        </p>

        {oldProofs === null ? (
          <p className="muted">Checking the published snapshot…</p>
        ) : oldEntry ? (
          <>
            <p>
              This wallet is in the snapshot for{" "}
              <strong>{fmtTokens(oldEntry.amount)}</strong> tokens.
            </p>
            <p className="muted small">
              {oldLeft ? `Window closes in ${oldLeft}.` : "The window has closed."}{" "}
              Anything unclaimed when it closes becomes staking rewards for the
              community — it does not come back to us.
            </p>
            <button className="primary" disabled={busy || !oldLeft} onClick={claimOldHolder}>
              {oldLeft ? "Claim" : "Window closed"}
            </button>
          </>
        ) : (
          <p className="muted">
            <strong>This wallet is not in the snapshot.</strong> That means it
            held no Buddy at the snapshot moment, or it was excluded — the
            excluded list below gives a reason for every address on it. The
            whole snapshot is published, so you can check rather than ask.
          </p>
        )}

        <SnapshotFiles />
      </section>

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

        {infProofs === null ? (
          <p className="muted">Checking the published list…</p>
        ) : infEntry ? (
          <>
            <p>
              This wallet is on the published list for{" "}
              <strong>{fmtTokens(infEntry.amount)}</strong> tokens.
            </p>
            <p className="muted small">
              {infLeft ? `You have ${infLeft} left.` : "The 72-hour window has closed."}{" "}
              Unclaimed allocations become staking rewards for the community.
            </p>

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
          <p className="muted">This wallet is not on the influencer list.</p>
        )}
      </section>

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

      {status && <div className="card status">{status}</div>}
    </div>
  );
}

/**
 * Links to the raw snapshot.
 *
 * "Check the published CSV" is only meaningful if the CSV is one click away,
 * so both actions are offered: view it in the browser to settle a question now,
 * download it to rebuild the Merkle tree and check the root yourself.
 */
function SnapshotFiles() {
  return (
    <div className="files">
      <div className="files-head">The published snapshot</div>
      {SNAPSHOT_FILES.map((f) => (
        <div className="file-row" key={f.name}>
          <div className="file-meta">
            <span className="mono file-name">{f.name}</span>
            <span className="file-desc">{f.description}</span>
          </div>
          <div className="file-actions">
            <a href={f.url} target="_blank" rel="noreferrer noopener">
              view
            </a>
            <a href={f.url} download>
              download
            </a>
          </div>
        </div>
      ))}
      <p className="file-foot">
        The list is built only from public Solana history, so anyone can rebuild
        it and get the same answer. Rebuild the tree from{" "}
        <span className="mono">holders.csv</span> and its root must equal the one
        stored on chain — the <strong>Verify</strong> tab has the command.
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
