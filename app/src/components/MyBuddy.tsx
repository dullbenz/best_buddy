import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { useEffect, useState } from "react";
import {
  CLUSTER,
  INFLUENCER_PROOFS_URL,
  INFLUENCER_TERMS,
  OLD_HOLDER_PROOFS_URL,
  ORIGINAL_SIGNER_DEADLINE,
  SEEDS,
  TERMS_API,
  TIERS,
  TOKEN_DECIMALS,
  UNSTAKE_COOLDOWN_SECONDS,
  btcTxUrl,
  ORIGINAL_MESSAGE,
  pda,
  signerClaimMessage,
  solscanTx,
  u64Seed,
} from "../config";
import { countdown, fmtAmount, fmtDate, fmtSol, shortAddress, shortSignature } from "../format";
import { goTo } from "../nav";
import {
  useClaimReceipts,
  useDistributor,
  useLockups,
  useStakePosition,
  useStream,
  type LockupEntry,
} from "../useDistributor";
import { useStreamHistory } from "../useClaimData";
import { useProgram } from "../useProgram";
import { Pager, usePaged } from "./Pager";
import { TierCards } from "./Staking";
import {
  ConnectToClaim,
  ForfeitNote,
  Progress,
  StreamExplainer,
  Verdict,
  useClock,
} from "./claimShared";

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

/**
 * What a signed-terms cache entry records: the signature, and whether it
 * actually reached the public register. `published` gates the "on the register"
 * copy so a POST that failed is never asserted as succeeded.
 */
interface TermsRecord {
  sig: string;
  published: boolean;
}

/** Short, stable fingerprint of the terms text (FNV-1a, 32-bit, 8 hex). */
function termsFingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const TERMS_HASH = termsFingerprint(INFLUENCER_TERMS);

/**
 * localStorage key for a wallet's terms signature.
 *
 * Namespaced by cluster and by a fingerprint of the terms text, so agreeing to
 * one version on one chain is never mistaken for agreeing to a different
 * version or on a different chain. A terms edit or a cluster switch simply
 * misses the old key and prompts a fresh signature, which is the correct
 * outcome: the old signature attested to text that no longer applies.
 */
function termsKey(address: string): string {
  return `buddy.terms.${CLUSTER}.${TERMS_HASH}.${address}`;
}

/** POST a signature to the public register; returns whether it was recorded. */
async function publishTerms(address: string, signature: string): Promise<boolean> {
  try {
    const res = await fetch(TERMS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * My Buddy: everything the connected wallet can personally do, on one page.
 *
 * The site's other tabs describe the system: who is owed what, how the pool is
 * fed, what the contract enforces. This page is the counterpart, addressed to
 * one wallet: its claims, its stream, its stake, and every button that signs
 * something. Actions live here and only here, so "where do I actually do it"
 * always has the same one-word answer, and the public pages can stay
 * readable without a wallet plugged in.
 */
export function MyBuddy() {
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const program = useProgram();
  const { config, refresh } = useDistributor();
  const { stream, refresh: refreshStream } = useStream(publicKey ?? null);
  const receipts = useClaimReceipts(publicKey ?? null);
  const { position, refresh: refreshPosition } = useStakePosition(publicKey ?? null);
  const { lockups, loading: lockupsLoading, refresh: refreshLockups } = useLockups(
    publicKey ?? null
  );

  const [oldProofs, setOldProofs] = useState<ProofFile | null>(null);
  const [infProofs, setInfProofs] = useState<ProofFile | null>(null);
  const [status, setStatus] = useState<{ text: string; signature?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The wallet's signature over INFLUENCER_TERMS, plus whether it reached the
  // public register. Gates the claim.
  //
  // Re-seeded from localStorage whenever the wallet changes, so someone who
  // signs, then reloads or comes back later, is not asked to sign the same
  // terms twice. The register is keyed by address, so a re-signature would be
  // a no-op server-side anyway.
  const [terms, setTerms] = useState<TermsRecord | null>(null);
  const address = publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (!address) {
      setTerms(null);
      return;
    }
    const raw = localStorage.getItem(termsKey(address));
    if (!raw) {
      setTerms(null);
      return;
    }
    try {
      setTerms(JSON.parse(raw) as TermsRecord);
    } catch {
      // Corrupt entry: drop it and let the wallet sign again.
      setTerms(null);
    }
  }, [address]);

  // A signature that never made it onto the register retries on mount. The
  // register is transparency, not a gate, so this is quiet: success flips the
  // stored flag, a failure just leaves it to try again next time.
  useEffect(() => {
    if (!address || !terms || terms.published) return;
    let cancelled = false;
    (async () => {
      const ok = await publishTerms(address, terms.sig);
      if (ok && !cancelled) {
        const record: TermsRecord = { sig: terms.sig, published: true };
        localStorage.setItem(termsKey(address), JSON.stringify(record));
        setTerms(record);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, terms]);

  useEffect(() => {
    loadProofs(OLD_HOLDER_PROOFS_URL).then(setOldProofs).catch(() => setOldProofs({}));
    loadProofs(INFLUENCER_PROOFS_URL).then(setInfProofs).catch(() => setInfProofs({}));
  }, []);

  const oldEntry = address ? oldProofs?.[address] : undefined;
  const infEntry = address ? infProofs?.[address] : undefined;

  const now = useClock();
  const oldLeft = config ? countdown(Number(config.oldHolderDeadline), now) : null;
  const infLeft = config ? countdown(Number(config.influencerDeadline), now) : null;

  /* ---- the actions. Every transaction the site can sign starts here. ---- */

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
      setStatus({ text: "Claimed. The tokens are in your wallet.", signature: sig });
      refresh();
      receipts.refresh();
    } catch (e: any) {
      setStatus({ text: `Failed: ${e?.message ?? String(e)}` });
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

      // Publishing is best-effort on purpose. The register is a transparency
      // aid, not a gate: refusing to let someone claim their allocation because
      // our own server was down would be the wrong failure. Record whether it
      // actually landed, so the UI never claims "on the register" for a post
      // that failed; an unpublished record retries on the next mount.
      const published = await publishTerms(signer, encoded);
      const record: TermsRecord = { sig: encoded, published };
      localStorage.setItem(termsKey(signer), JSON.stringify(record));
      setTerms(record);

      setStatus({
        text: published
          ? "Terms signed and published to the public register. You can claim now."
          : "Terms signed. The public register could not be reached, so it was not recorded there yet, but you can still claim and it will retry.",
      });
    } catch (e: any) {
      setStatus({ text: `Not signed: ${e?.message ?? String(e)}` });
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
      setStatus({
        text: `Claimed ${fmtAmount(infEntry.amount)} as your influencer allocation. The stream is open.`,
        signature: sig,
      });
      refresh();
      receipts.refresh();
      refreshStream();
    } catch (e: any) {
      setStatus({ text: `Failed: ${e?.message ?? String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  /** Read what a stream_withdraw actually released, from its log. */
  async function releasedIn(signature: string): Promise<bigint | null> {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      const line = (tx?.meta?.logMessages ?? []).find((l) =>
        l.includes("stream_withdraw:")
      );
      const amount = line?.match(/released (\d+)/)?.[1];
      return amount ? BigInt(amount) : null;
    } catch {
      return null;
    }
  }

  /**
   * Claim bucket 4a by proving control of the 2014 Bitcoin key.
   *
   * No wallet signature proves anything here; the authorisation is the
   * Bitcoin signature itself, made offline in whatever wallet holds that key.
   * The connected wallet only pays the fee and names where the tokens go, and
   * the message binds the signature to that address so a copied signature
   * cannot be redirected to someone else's wallet.
   */
  async function claimOriginalSigner(base64Signature: string) {
    if (!program || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const raw = Buffer.from(base64Signature.trim(), "base64");
      if (raw.length !== 65) {
        throw new Error(
          `That is not a Bitcoin message signature. Expected 65 bytes once decoded, got ${raw.length}.`
        );
      }
      const header = raw[0];
      if (!((header >= 27 && header <= 30) || (header >= 31 && header <= 34))) {
        throw new Error(`Unrecognised signature header byte (${header}).`);
      }

      const sig = await program.methods
        .claimOriginalSigner(publicKey, header, Array.from(raw.subarray(1)))
        .accountsPartial({
          payer: publicKey,
          config: pda([SEEDS.config]),
          stream: pda([SEEDS.stream, publicKey.toBuffer()]),
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus({
        text: "Signature accepted. The 2014 signer's stream is open to this wallet.",
        signature: sig,
      });
      refresh();
      refreshStream();
    } catch (e: any) {
      setStatus({ text: `Failed: ${e?.message ?? String(e)}` });
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
      const released = await releasedIn(sig);
      setStatus({
        text: released
          ? `Withdrawal of ${fmtAmount(released)} successful.`
          : "Withdrawal successful.",
        signature: sig,
      });
      refresh();
      refreshStream();
    } catch (e: any) {
      setStatus({ text: `Failed: ${e?.message ?? String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  /* ---- staking actions ---- */

  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [lockAmount, setLockAmount] = useState("");
  // No preselected lock: a 150-day commitment should never be a default.
  const [lockTier, setLockTier] = useState(-1);

  async function runStake(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      const sig = await fn();
      setStatus({ text: `${label}.`, signature: sig });
      refresh();
      refreshPosition();
      refreshLockups();
    } catch (e: any) {
      setStatus({ text: `Failed: ${e?.message ?? String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  const toRaw = (amount: string) =>
    BigInt(Math.round(parseFloat(amount) * 10 ** TOKEN_DECIMALS));

  const stakeAccounts = async () => ({
    owner: publicKey!,
    config: pda([SEEDS.config]),
    pool: pda([SEEDS.pool]),
    position: pda([SEEDS.stake, publicKey!.toBuffer()]),
    vault: pda([SEEDS.vault]),
    solVault: pda([SEEDS.solVault]),
    destination: await ensureAta(),
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const stake = () =>
    runStake("Staked", async () => {
      const source = await ensureAta();
      return program!.methods
        .stake(new BN(toRaw(stakeAmount).toString()))
        .accountsPartial({
          owner: publicKey!,
          config: pda([SEEDS.config]),
          pool: pda([SEEDS.pool]),
          position: pda([SEEDS.stake, publicKey!.toBuffer()]),
          vault: pda([SEEDS.vault]),
          source,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

  const claimRewards = () =>
    runStake("Rewards claimed", async () =>
      program!.methods.claimRewards().accountsPartial(await stakeAccounts()).rpc()
    );

  const requestUnstake = () =>
    runStake("Cooldown started", async () =>
      program!.methods
        .requestUnstake()
        .accountsPartial({
          owner: publicKey!,
          position: pda([SEEDS.stake, publicKey!.toBuffer()]),
        })
        .rpc()
    );

  const unstake = (raw: bigint) =>
    runStake("Unstaked", async () =>
      program!.methods
        .unstake(new BN(raw.toString()))
        .accountsPartial(await stakeAccounts())
        .rpc()
    );

  const lockNew = () =>
    runStake("Locked", async () => {
      const source = await ensureAta();
      const counter = pda([SEEDS.lockupCount, publicKey!.toBuffer()]);
      // The program requires index == counter.count; no counter yet means 0.
      let index = 0n;
      try {
        const c = await (program!.account as any).lockupCounter.fetch(counter);
        index = BigInt(c.count.toString());
      } catch {
        index = 0n;
      }
      return program!.methods
        .lockTokens(new BN(toRaw(lockAmount).toString()), lockTier, new BN(index.toString()))
        .accountsPartial({
          owner: publicKey!,
          config: pda([SEEDS.config]),
          pool: pda([SEEDS.pool]),
          counter,
          lockup: pda([SEEDS.lockup, publicKey!.toBuffer(), u64Seed(index)]),
          vault: pda([SEEDS.vault]),
          source,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

  const lockupAccounts = async (lockup: PublicKey) => ({
    owner: publicKey!,
    config: pda([SEEDS.config]),
    pool: pda([SEEDS.pool]),
    lockup,
    vault: pda([SEEDS.vault]),
    solVault: pda([SEEDS.solVault]),
    destination: await ensureAta(),
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const claimLockup = (l: LockupEntry) =>
    runStake("Lock-up rewards claimed", async () =>
      program!.methods
        .claimLockupRewards()
        .accountsPartial(await lockupAccounts(l.pubkey))
        .rpc()
    );

  const unlock = (l: LockupEntry) =>
    runStake("Unlocked. Principal, boost and rewards are in your wallet", async () =>
      program!.methods
        .unlockTokens()
        .accountsPartial(await lockupAccounts(l.pubkey))
        .rpc()
    );

  const exitLockup = (l: LockupEntry) =>
    runStake("Exited early", async () =>
      program!.methods
        .emergencyExitLockup()
        .accountsPartial(await lockupAccounts(l.pubkey))
        .rpc()
    );

  /* ---- derived figures ---- */

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

  // Flexible exits in two steps: request, wait out the cooldown, withdraw. The
  // cooldown is the program's own constant, not a hardcoded day, so a fast-clock
  // devnet build counts down the seconds the chain actually enforces.
  const requestedAt = position ? Number(position.unstakeRequestedAt) : 0;
  const cooldownLeft =
    requestedAt > 0 ? countdown(requestedAt + UNSTAKE_COOLDOWN_SECONDS, now) : null;
  const canUnstake = requestedAt > 0 && !cooldownLeft;

  /* ---- the page ---- */

  if (!publicKey) {
    return (
      <div className="stack">
        <section className="card">
          <h2>My Buddy</h2>
          <p className="muted">
            This page is the one place on the site that acts for a specific
            wallet: its claims, its stream, its stake, and every button that
            signs a transaction. Connect a wallet and it fills in with what
            that wallet can do; nothing about you is stored anywhere, because
            everything shown here is read from the chain on every visit.
          </p>
          <div className="claim-cta">
            <span>Nothing to see without a wallet.</span>
            <button className="primary" onClick={() => setVisible(true)}>
              Connect wallet
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!config) return <div className="card">Loading on-chain state…</div>;

  const checking = oldProofs === null || infProofs === null || receipts.loading;
  const nothingToClaim =
    !checking && !oldEntry && !infEntry && !receipts.oldHolder && !receipts.influencer;

  return (
    <div className="stack">
      <section className="card">
        <h2>My Buddy</h2>
        <p className="muted">
          Everything <span className="mono">{shortAddress(publicKey.toBase58())}</span>{" "}
          can claim, withdraw and stake, in one place. The other tabs describe
          the system; this one acts for your wallet, and it is the only page
          that does.
        </p>
      </section>

      {status && (
        <div className="card status">
          <span>{status.text}</span>
          {status.signature && (
            <a
              className="mono"
              href={solscanTx(status.signature)}
              title={status.signature}
              target="_blank"
              rel="noreferrer noopener"
            >
              {shortSignature(status.signature)} <span aria-hidden="true">&#8599;</span>
            </a>
          )}
        </div>
      )}

      {/* ---- claims ---- */}
      <section className="card">
        <h2>Your claims</h2>
        <p className="muted small">
          Checked against the published lists, live. What each list is and how
          it was built is on the <TabLink tab="claims">Claims</TabLink> tab;
          this is only whether <em>this wallet</em> is on one.
        </p>

        {checking ? (
          <p className="muted">Checking the published lists…</p>
        ) : (
          <>
            {nothingToClaim && (
              <Verdict tone="miss" heading="Nothing to claim with this wallet.">
                <p>
                  It is on neither published list. If you expected otherwise,
                  the <TabLink tab="claims">Claims</TabLink> tab lets you check
                  any address against both lists and read every exclusion and
                  the reason for it.
                </p>
              </Verdict>
            )}

            {receipts.oldHolder && (
              <Verdict tone="done" heading="Legacy holder claim: paid out.">
                <p>
                  <strong>{fmtAmount(receipts.oldHolder.amount)}</strong> was sent to
                  this wallet on {fmtDate(receipts.oldHolder.claimedAt)}. The contract
                  records one receipt per wallet and will not pay a second time.
                </p>
              </Verdict>
            )}

            {oldEntry && !receipts.oldHolder && (
              <Verdict tone="hit" heading="This wallet is in the legacy $Buddy holder snapshot.">
                <p>
                  It is owed <strong>{fmtAmount(oldEntry.amount)}</strong>, paid in
                  full the moment you claim: no lockup, no vesting, no strings.{" "}
                  {oldLeft ? `The claim window closes in ${oldLeft}.` : "The window has closed."}
                </p>
                <button className="primary" disabled={busy || !oldLeft} onClick={claimOldHolder}>
                  {oldLeft ? "Claim" : "Window closed"}
                </button>
              </Verdict>
            )}

            {receipts.influencer && (
              <Verdict tone="done" heading="Influencer claim: the stream is open.">
                <p>
                  <strong>{fmtAmount(receipts.influencer.amount)}</strong> was
                  committed to this wallet on {fmtDate(receipts.influencer.claimedAt)}
                  , releasing across 30 days from then. Withdraw from the stream
                  below whenever you like.
                </p>
              </Verdict>
            )}

            {infEntry && !receipts.influencer && (
              <Verdict tone="hit" heading="This wallet is on the influencer list.">
                <p>
                  It is allocated <strong>{fmtAmount(infEntry.amount)}</strong>,
                  released gradually across 30 days from the moment you claim,
                  nothing up front.{" "}
                  {infLeft ? `You have ${infLeft} left to claim.` : "The 72-hour window has closed."}
                </p>

                <details className="terms" open={!terms}>
                  <summary>The terms you are agreeing to</summary>
                  <pre className="terms-body">{INFLUENCER_TERMS}</pre>
                </details>

                {terms ? (
                  terms.published ? (
                    <p>
                      ✓ Terms signed by this wallet, and added to the{" "}
                      <a href={TERMS_API} target="_blank" rel="noreferrer noopener">
                        public register
                      </a>
                      .
                    </p>
                  ) : (
                    <p>
                      ✓ Terms signed by this wallet. Not yet on the{" "}
                      <a href={TERMS_API} target="_blank" rel="noreferrer noopener">
                        public register
                      </a>{" "}
                      — it will retry. You can claim now regardless.
                    </p>
                  )
                ) : (
                  <p>
                    Sign the terms before claiming. This costs nothing and is not a
                    transaction; it is a message signed with your key, proving these
                    terms were shown and accepted. Your wallet will display the
                    full text, so you can read exactly what you are agreeing to.
                  </p>
                )}

                <div className="button-row">
                  {!terms && (
                    <button disabled={busy || !infLeft || !signMessage} onClick={signTerms}>
                      {signMessage ? "Sign the terms" : "Wallet cannot sign messages"}
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={busy || !infLeft || !terms}
                    onClick={claimInfluencer}
                  >
                    {infLeft ? "Claim and open stream" : "Window closed"}
                  </button>
                </div>
              </Verdict>
            )}
          </>
        )}

        <ForfeitNote label="If you don't claim">
          Anything left unclaimed when a window closes becomes staking rewards
          for the community. There is no instruction that returns it to the
          team, and no exception process, however good the reason.
        </ForfeitNote>
      </section>

      {/* ---- the stream ---- */}
      {stream ? (
        <StreamCard
          stream={stream}
          withdrawable={withdrawable}
          busy={busy}
          onWithdraw={withdrawStream}
          beneficiary={publicKey}
        />
      ) : null}

      {/* ---- staking: the flexible position ---- */}
      <section className="card">
        <h2>Your flexible stake</h2>

        {position ? (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-value">{fmtAmount(position.amount, true)}</span>
                <span className="stat-label">Staked</span>
              </div>
              <div className="stat">
                <span className="stat-value">{fmtAmount(position.claimableToken, true)}</span>
                <span className="stat-label">Base, claimable now</span>
              </div>
              <div className="stat">
                <span className="stat-value">{fmtSol(position.claimableSol)} SOL</span>
                <span className="stat-label">SOL rewards</span>
              </div>
            </div>

            {cooldownLeft && (
              <p className="muted small">
                Exit requested. You can unstake in {cooldownLeft}, and the stake
                keeps earning until you actually withdraw.
              </p>
            )}

            <div className="button-row">
              <button disabled={busy} onClick={claimRewards}>
                Claim rewards
              </button>
              {requestedAt === 0 && (
                <button disabled={busy} onClick={requestUnstake}>
                  Start 24h exit
                </button>
              )}
            </div>

            {canUnstake && (
              <div className="form-row">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount to unstake"
                  value={unstakeAmount}
                  onChange={(e) => setUnstakeAmount(e.target.value)}
                />
                <button
                  disabled={busy || !unstakeAmount || parseFloat(unstakeAmount) <= 0}
                  onClick={() => unstake(toRaw(unstakeAmount))}
                >
                  Unstake
                </button>
                <button
                  disabled={busy}
                  onClick={() => unstake(BigInt(position.amount.toString()))}
                >
                  Unstake all
                </button>
              </div>
            )}

            <hr className="rule" />
            <h3 className="tiers-title">Add to your stake</h3>
          </>
        ) : (
          <p className="muted">
            Nothing staked flexibly from this wallet yet. Flexible earns the
            base rate on every reward the ecosystem generates, claims any time,
            and exits a day after you ask, with no penalty, ever. The full
            terms are on the <TabLink tab="staking">Staking</TabLink> tab.
          </p>
        )}

        <div className="form-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="Amount to stake"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !stakeAmount || parseFloat(stakeAmount) <= 0}
            onClick={stake}
          >
            Stake flexible
          </button>
        </div>
      </section>

      {/* ---- staking: the lock-ups, one row per account ---- */}
      <section className="card">
        <h2>Your lock-ups</h2>
        <p className="muted small">
          Each lock-up is its own position with its own amount, its own clock
          and its own escrowed boost, so each one is shown and managed on its
          own row.
        </p>

        {lockupsLoading && lockups.length === 0 ? (
          <p className="muted">Reading your lock-ups…</p>
        ) : lockups.length === 0 ? (
          <p className="muted">
            No lock-ups from this wallet yet. Locking multiplies your share of
            every reward for as long as you commit; what each length pays and
            costs is spelled out on the <TabLink tab="staking">Staking</TabLink>{" "}
            tab and on the cards below.
          </p>
        ) : (
          <div className="files">
            <div className="files-head">
              {lockups.length} lock-up{lockups.length === 1 ? "" : "s"}
              <span className="files-note">
                read from the chain on every visit; each row is its own account
              </span>
            </div>
            {lockups.map((l) => (
              <LockupRow
                key={l.pubkey.toBase58()}
                lockup={l}
                now={now}
                busy={busy}
                onClaim={() => claimLockup(l)}
                onUnlock={() => unlock(l)}
                onExit={() => exitLockup(l)}
              />
            ))}
          </div>
        )}

        <hr className="rule" />
        <h3 className="tiers-title">Open a new lock-up</h3>
        <TierCards selected={lockTier} onSelect={setLockTier} ids={[1, 2, 3]} />
        <div className="form-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="Amount to lock"
            value={lockAmount}
            onChange={(e) => setLockAmount(e.target.value)}
          />
          <button
            className="primary"
            disabled={
              busy || lockTier < 0 || !lockAmount || parseFloat(lockAmount) <= 0
            }
            onClick={lockNew}
          >
            {lockTier >= 0 ? `Lock for ${TIERS[lockTier].name}` : "Pick a lock length"}
          </button>
        </div>
      </section>

      {/* ---- the 2014 key, folded away ---- */}
      <section className="card">
        <details className="terms">
          <summary>I hold the Bitcoin key that signed the 2014 message</summary>
          <div className="terms-inner">
            <SignerClaimBody
              config={config}
              wallet={publicKey}
              busy={busy}
              onClaim={claimOriginalSigner}
            />
          </div>
        </details>
        <ForfeitNote label="Why this is here">
          A share of the supply is reserved until{" "}
          {fmtDate(ORIGINAL_SIGNER_DEADLINE)} for whoever controls the key that
          signed the message this coin is named after. Almost nobody reading
          this holds it, which is why it is folded away, but the claim is an
          action like any other, so it lives on this page.
        </ForfeitNote>
      </section>
    </div>
  );
}

/** Anchor decodes the `Tier` enum as `{ oneMonth: {} }`; map it back to TIERS. */
const TIER_IDS: Record<string, number> = {
  flexible: 0,
  oneMonth: 1,
  threeMonth: 2,
  fiveMonth: 3,
};

/**
 * One lock-up as a row: what is in it, where its clock stands, and the
 * things its owner can do about it right now.
 */
function LockupRow({
  lockup,
  now,
  busy,
  onClaim,
  onUnlock,
  onExit,
}: {
  lockup: LockupEntry;
  now: number;
  busy: boolean;
  onClaim: () => void;
  onUnlock: () => void;
  onExit: () => void;
}) {
  const a = lockup.account;
  const tier = TIERS[TIER_IDS[Object.keys(a.tier ?? {})[0]] ?? 0];
  const left = countdown(Number(a.lockEnd), now);
  const claimableSol = BigInt(a.claimableSol.toString());
  const escrowToken = BigInt(a.escrowToken.toString());
  const escrowSol = BigInt(a.escrowSol.toString());

  // No principal leaves inside the first cooldown window, by any route (the
  // program gates early exit on created_at + the same cooldown flexible
  // unstaking uses). Read from the constant so a fast-clock build agrees with
  // the chain; surface the wait rather than let the button send a failing tx.
  const exitUnlocksAt = Number(a.createdAt) + UNSTAKE_COOLDOWN_SECONDS;
  const floorLeft = countdown(exitUnlocksAt, now);

  const state = left
    ? `matures in ${left}`
    : a.demoted
      ? "matured; earning at 1x until you withdraw"
      : `matured; still earning at ${tier.multiplier} until demoted — withdrawing demotes automatically, and the demote crank lives on the Fund pool tab`;

  return (
    <div className="file-row">
      <div className="file-meta">
        <span className="file-name">
          {fmtAmount(a.amount, true)} · {tier.name} at {tier.multiplier} · {state}
        </span>
        <span className="file-desc">
          claimable now: {fmtAmount(a.claimableToken, true)}
          {claimableSol > 0n ? ` + ${fmtSol(claimableSol)} SOL` : ""}
          {escrowToken > 0n || escrowSol > 0n
            ? ` · boost in escrow: ${fmtAmount(escrowToken, true)}${
                escrowSol > 0n ? ` + ${fmtSol(escrowSol)} SOL` : ""
              }`
            : ""}
        </span>
      </div>
      <div className="file-actions">
        <button disabled={busy} onClick={onClaim}>
          Claim rewards
        </button>
        {left ? (
          <button
            className="danger"
            disabled={busy || !!floorLeft}
            onClick={onExit}
            title={floorLeft ? "Early exit unlocks 24 hours after you locked" : undefined}
          >
            {floorLeft
              ? `Emergency exit in ${floorLeft}`
              : "Emergency exit (forfeit boost + 15%)"}
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={onUnlock}>
            Unlock
          </button>
        )}
      </div>
    </div>
  );
}

/** An inline link that changes tab, styled as a link rather than a button. */
function TabLink({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <button type="button" className="inline-link" onClick={() => goTo(tab)}>
      {children}
    </button>
  );
}

/**
 * Everything about this wallet's own stream, as a card.
 *
 * The three totals answer "how much and when", and the history answers "what
 * have I already done", which the stream account itself cannot, because it
 * keeps a running total and no record of the individual releases. Those are
 * recovered from the transactions that touched the account.
 */
function StreamCard({
  stream,
  withdrawable,
  busy,
  onWithdraw,
  beneficiary,
}: {
  stream: any;
  withdrawable: number;
  busy: boolean;
  onWithdraw: () => void;
  beneficiary: PublicKey | null;
}) {
  const { events, loading } = useStreamHistory(beneficiary);
  const history = usePaged(events, 10);
  const total = BigInt(stream.total.toString());
  const withdrawn = BigInt(stream.withdrawn.toString());
  const end = Number(stream.end);
  const left = countdown(end);
  const releasedPct = total === 0n ? 0 : Number((withdrawn * 10000n) / total) / 100;

  return (
    <section className="card">
      <h2>Your stream</h2>
      <p className="muted">
        {fmtAmount(total)} committed to this wallet, releasing steadily until{" "}
        {fmtDate(end)}.{" "}
        {left
          ? `${left} left to run. Anything already released stays yours whether you take it now or later.`
          : "Fully matured: all of it is available, and it stays available indefinitely."}
      </p>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{fmtAmount(total, true)}</span>
          <span className="stat-label">Total committed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmtAmount(withdrawn, true)}</span>
          <span className="stat-label">Withdrawn · {releasedPct.toFixed(1)}%</span>
        </div>
        <div className="stat stat-emphasis">
          <span className="stat-value stat-live">
            {fmtAmount(BigInt(Math.floor(withdrawable)))}
          </span>
          <span className="stat-label">Available right now · updating live</span>
        </div>
      </div>

      <Progress done={Number(withdrawn)} total={Number(total)} />

      <div className="stream-actions">
        <button className="primary" disabled={busy || withdrawable < 1} onClick={onWithdraw}>
          {withdrawable < 1 ? "Nothing available yet" : "Withdraw available"}
        </button>
        <span className="muted small">
          Withdraw as often or as rarely as you like. You've already claimed, so it never expires.
        </span>
      </div>

      <StreamExplainer />

      <div className="files">
        <div className="files-head">
          Transaction history
          <span className="files-note">
            read from the transactions that touched this stream, not from a log
            we keep, so every row is checkable on an explorer.
          </span>
        </div>
        {loading ? (
          <p className="file-foot">Reading the chain…</p>
        ) : events.length === 0 ? (
          <p className="file-foot">
            Nothing withdrawn yet. When you do, it will appear here.
          </p>
        ) : (
          history.slice.map((e) => (
            <div className="file-row" key={e.signature}>
              <div className="file-meta">
                <span className="file-name">
                  {e.kind === "withdraw"
                    ? e.amount === null
                      ? "Withdrawal"
                      : `Withdrew ${fmtAmount(e.amount)}`
                    : `Claimed ${fmtAmount(total)} and opened this stream`}
                </span>
                <span className="file-desc">
                  {e.at ? fmtDate(e.at) : "time unknown"}
                </span>
              </div>
              <div className="file-actions">
                <a
                  className="mono"
                  href={solscanTx(e.signature)}
                  title={e.signature}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {shortSignature(e.signature)}
                </a>
              </div>
            </div>
          ))
        )}
        <div className="file-foot">
          <Pager
            page={history.page}
            pageCount={history.pageCount}
            from={history.from}
            to={history.to}
            total={history.total}
            unit="transactions"
            onPage={history.setPage}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Bucket 4a: whoever holds the Bitcoin key that signed the 2014 message.
 *
 * The odd one out among the claims. There is no list to be on and no wallet
 * signature that helps: the authorisation is a Bitcoin signature made offline,
 * in whatever wallet holds a key from 2014, over a message naming the Solana
 * address the tokens should go to. That binding is what stops a signature
 * posted publicly from being replayed into someone else's wallet, and it is
 * why the message has to be regenerated for each destination rather than
 * signed once.
 */
function SignerClaimBody({
  config,
  wallet,
  busy,
  onClaim,
}: {
  config: any;
  wallet: PublicKey;
  busy: boolean;
  onClaim: (signature: string) => void;
}) {
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);

  const message = signerClaimMessage(wallet.toBase58());
  const left = countdown(ORIGINAL_SIGNER_DEADLINE);
  const claimed = config?.originalSignerClaimed === true;
  const swept = config?.originalSignerSwept === true;

  if (swept) {
    return (
      <Verdict tone="done" heading="Unclaimed, and now gone to the stakers.">
        <p>
          The deadline passed without anyone proving control of the key, so
          this allocation became staking rewards for the community.
        </p>
      </Verdict>
    );
  }
  if (claimed) {
    return (
      <Verdict tone="done" heading="Claimed. The original signer came back.">
        <p>
          Somebody proved control of the 2014 key, and their stream is open.
          Nothing further can be claimed here.
        </p>
      </Verdict>
    );
  }

  return (
    <>
      <p className="muted small">
        Nobody can approve or refuse this, not us and not anyone. The contract
        recovers the public key from the signature and compares it to the one
        frozen in its config. It either matches or it does not.{" "}
        <a
          href={btcTxUrl(ORIGINAL_MESSAGE.txid)}
          target="_blank"
          rel="noreferrer noopener"
        >
          The 2014 transaction <span aria-hidden="true">&#8599;</span>
        </a>
      </p>

      <div className="signer-step">
        <span className="signer-step-num">1</span>
        <div>
          <strong>Sign this exact text with the 2014 Bitcoin key.</strong>
          <p className="muted small">
            Use whatever wallet holds it: Electrum's <em>Sign/Verify</em>{" "}
            dialog, or <span className="mono">signmessage</span> in Bitcoin
            Core. The address below is this connected wallet, and the
            signature is bound to it, so tokens can only ever arrive here.
          </p>
          <div className="signer-message">
            <code>{message}</code>
            <button
              type="button"
              className="copy"
              onClick={() => {
                navigator.clipboard?.writeText(message);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="signer-step">
        <span className="signer-step-num">2</span>
        <div>
          <strong>Paste the signature it gives you.</strong>
          <p className="muted small">
            A base64 string, usually ending in <span className="mono">=</span>.
            Nothing is sent anywhere until you press claim.
          </p>
          <textarea
            className="signer-input"
            rows={3}
            spellCheck={false}
            placeholder="H1a2b3c…="
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
        </div>
      </div>

      <div className="stream-actions">
        <button
          className="primary"
          disabled={busy || !signature.trim() || !left}
          onClick={() => onClaim(signature)}
        >
          {left ? "Prove it and claim" : "The deadline has passed"}
        </button>
        {left && <span className="muted small">{left} left to claim</span>}
      </div>
    </>
  );
}
