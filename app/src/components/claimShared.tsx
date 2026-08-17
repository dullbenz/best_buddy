import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Pieces shared between the public Claims page and My Buddy, the personal
 * page. They were born on the Claims page; when every wallet action moved to
 * My Buddy the presentation had to follow, and duplicating it would mean the
 * two pages drifting apart one edit at a time.
 */

/**
 * The way in, at the end of each bucket card.
 *
 * Opens the wallet picker rather than re-implementing the header's button, so
 * there is one wallet flow on the page and not two that can disagree.
 */
export function ConnectToClaim({ question }: { question: string }) {
  const { setVisible } = useWalletModal();
  return (
    <div className="claim-cta">
      <span>{question} Connect wallet to claim.</span>
      <button className="primary" onClick={() => setVisible(true)}>
        Connect wallet
      </button>
    </div>
  );
}

/**
 * The answer to "does this wallet have anything", boxed.
 *
 * This is what the visitor came for, and it was a paragraph of muted body text
 * indistinguishable from the explanation around it: a "no" that scrolled past
 * unread. It is the one thing on the card addressed to them personally, so it
 * gets the only strong border on the card.
 */
export function Verdict({
  tone,
  heading,
  children,
}: {
  tone: "hit" | "miss" | "done";
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
 * fact still matters (it is the difference between a forfeited allocation
 * going to the community and going back to the team), but it is the same fact
 * on every visit, and it should not shout on every visit.
 */
export function ForfeitNote({
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
 * What a "30-day stream" actually is, in mechanical terms.
 *
 * People reasonably assume a stream is a promise someone keeps. It is not. It
 * is arithmetic in an account nobody can edit, so it is worth showing the
 * arithmetic.
 */
export function StreamExplainer() {
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
      Withdrawing is a normal transaction you send whenever you like: daily,
      once at the end, or never. Nothing is automatic and nothing expires: a
      matured stream stays yours indefinitely.
      <br />
      <span className="muted">
        The tokens stay in the contract's vault until each withdrawal, and no
        instruction exists to release them faster, not for you and not for us. The
        stream is keyed to your wallet, so nobody else can withdraw it. Equally,
        there is no instruction to cancel or claw one back: once opened, it runs
        to completion whatever anyone thinks of you afterwards.
      </span>
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const p = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(p)}>
      <div className="progress-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

/**
 * A clock that ticks, for values that change with time rather than with data.
 *
 * Streams vest per second. Reading `Date.now()` during render gives a number
 * that is correct at first paint and wrong from then until something unrelated
 * happens to re-render, which is why the available balance only moved on a
 * manual refresh. Nothing here touches the network: the chain already told us
 * the start, end and total, so the rest is arithmetic the browser can do.
 */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
