import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useEffect, useState } from "react";
import {
  INFLUENCER_PROOFS_URL,
  OLD_HOLDER_PROOFS_URL,
  SEEDS,
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
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, refresh } = useDistributor();
  const { stream } = useStream(publicKey ?? null);

  const [oldProofs, setOldProofs] = useState<ProofFile | null>(null);
  const [infProofs, setInfProofs] = useState<ProofFile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <h2>Old Buddy holder</h2>
        {oldProofs === null ? (
          <p className="muted">Checking the published snapshot…</p>
        ) : oldEntry ? (
          <>
            <p>
              This wallet is in the snapshot for{" "}
              <strong>{fmtTokens(oldEntry.amount)}</strong> tokens.
            </p>
            <p className="muted small">
              Paid immediately, no lockup. {oldLeft ? `Window closes in ${oldLeft}.` : "The window has closed."}
            </p>
            <button className="primary" disabled={busy || !oldLeft} onClick={claimOldHolder}>
              {oldLeft ? "Claim" : "Window closed"}
            </button>
          </>
        ) : (
          <p className="muted">
            This wallet is not in the old-holder snapshot. If you believe that is
            wrong, check the published CSV — it is reproducible from public chain
            data.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Influencer allocation</h2>
        {infProofs === null ? (
          <p className="muted">Checking the published list…</p>
        ) : infEntry ? (
          <>
            <p>
              This wallet is on the published list for{" "}
              <strong>{fmtTokens(infEntry.amount)}</strong> tokens.
            </p>
            <p className="muted small">
              Claiming opens a 30-day stream rather than transferring at once.{" "}
              {infLeft ? `You have ${infLeft} left.` : "The 72-hour window has closed."}
            </p>
            <button className="primary" disabled={busy || !infLeft} onClick={claimInfluencer}>
              {infLeft ? "Claim and open stream" : "Window closed"}
            </button>
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
