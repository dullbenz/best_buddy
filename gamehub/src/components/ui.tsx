/**
 * The small shared pieces every page uses.
 *
 * Kept together because they are all a few lines each and they only make sense
 * as a set: a rank has a badge, a badge sits next to a wallet, a wallet appears
 * in a leaderboard and a feed.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

import { RANKS, STAKING_URL, rankFor } from "../config";
import { countdown, commas, shortAddress } from "../lib/format";
import { navigate } from "../router";
import { useClock } from "../lib/poll";
import { useName } from "../lib/names";
import { BONE_PATH } from "./buddy/poses";

/* ----------------------------------------------------------------- bone */

export function BoneGlyph({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 60 38" width={size} height={(size * 38) / 60} className={className} aria-hidden="true">
      <path d={BONE_PATH} />
    </svg>
  );
}

/* ----------------------------------------------------------- rank badge */

export function RankBadge({
  rank,
  size = "sm",
  showName = true,
}: {
  rank: string;
  size?: "sm" | "lg";
  showName?: boolean;
}) {
  const entry = RANKS.find((candidate) => candidate.key === rank) || RANKS[0];
  return (
    <span
      className={`rank-badge ${size === "lg" ? "rank-badge-lg" : ""} ${
        entry.key === "immortal" ? "rank-immortal" : ""
      }`}
      style={{ ["--rank-color" as any]: `var(--rank-${entry.key})` }}
      title={entry.blurb}
    >
      <BoneGlyph size={size === "lg" ? 18 : 13} />
      {showName && entry.name}
    </span>
  );
}

/* ---------------------------------------------------------- wallet chip */

export function WalletChip({
  address,
  rank,
  you = false,
  link = true,
}: {
  address: string;
  rank?: string;
  you?: boolean;
  link?: boolean;
}) {
  // Hooks run before the early return below, so this is declared unconditionally.
  const name = useName(address);

  if (!address) return <span className="muted">—</span>;

  const inner = (
    <>
      {rank && <span className="rank-dot" style={{ ["--rank-color" as any]: `var(--rank-${rank})` }} />}
      {name ? (
        <>
          {/* The address stays. A pump.fun username is a self-chosen label on
              someone else's service — it can change, and it can imitate. */}
          <span className="wallet-chip-name">{name.username}</span>
          <span className="wallet-chip-address wallet-chip-address-dim">
            {shortAddress(address, 4, 4)}
          </span>
        </>
      ) : (
        <span className="wallet-chip-address">{shortAddress(address)}</span>
      )}
      {you && <span className="wallet-chip-you">you</span>}
    </>
  );

  if (!link) return <span className="wallet-chip">{inner}</span>;

  return (
    <a
      className="wallet-chip"
      href={`/wallet/${address}`}
      onClick={(event) => {
        event.preventDefault();
        navigate("profile", address);
      }}
    >
      {inner}
    </a>
  );
}

/* ------------------------------------------------------------ countdown */

export function CountdownClock({
  until,
  urgentUnderMs = 6 * 3600 * 1000,
  prefix,
  onZero,
}: {
  until: string | number;
  urgentUnderMs?: number;
  prefix?: string;
  onZero?: () => void;
}) {
  const now = useClock(1000);
  const target = typeof until === "string" ? Date.parse(until) : until;
  const remaining = target - now;
  const firedRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0 && !firedRef.current && onZero) {
      firedRef.current = true;
      onZero();
    }
  }, [remaining, onZero]);

  if (!Number.isFinite(target)) return null;

  return (
    <span className={`mono ${remaining < urgentUnderMs ? "tone-warn" : ""}`}>
      {prefix ? `${prefix} ` : ""}
      {countdown(remaining)}
    </span>
  );
}

/* --------------------------------------------------------- streak flame */

export function StreakFlame({ days, endsAt }: { days: number; endsAt?: string | null }) {
  const now = useClock(30000);
  const hoursLeft = endsAt ? (Date.parse(endsAt) - now) / 3600000 : Infinity;
  const warning = days > 0 && hoursLeft < 6;

  if (!days) {
    return <span className="muted mono">no streak yet</span>;
  }

  return (
    <span className={`streak-flame ${warning ? "streak-warning" : ""}`} title={
      warning ? "Play today or the streak resets" : `${days}-day streak`
    }>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M12 2c1 4-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2 1-3 2 2 3 4 3 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" />
      </svg>
      {days}-day streak
      {warning && <span className="label"> · ends soon</span>}
    </span>
  );
}

/* ---------------------------------------------------------- points delta */

export type Delta = { id: number; amount: number; x: number; y: number };

export function PointsDeltas({ deltas }: { deltas: Delta[] }) {
  return (
    <>
      {deltas.map((delta) => (
        <span key={delta.id} className="points-delta" style={{ left: delta.x, top: delta.y }}>
          +{delta.amount}
        </span>
      ))}
    </>
  );
}

/** Manages a short-lived queue of floating +N markers. */
export function useDeltas() {
  const [deltas, setDeltas] = useState<Delta[]>([]);
  const nextId = useRef(0);

  const push = (amount: number, x: number, y: number) => {
    const id = nextId.current++;
    setDeltas((current) => [...current, { id, amount, x, y }]);
    window.setTimeout(() => setDeltas((current) => current.filter((delta) => delta.id !== id)), 950);
  };

  return { deltas, push };
}

/* -------------------------------------------------------- milestone bar */

export function MilestoneBar({
  current,
  target,
  label,
}: {
  current: number;
  target: number | null;
  label?: string;
}) {
  // A missing target means the aggregator has not written the counter yet, not
  // that every milestone is behind us. Filling the bar and declaring victory at
  // four pets is worse than saying nothing.
  const known = typeof target === "number" && target > 0;
  const pct = known ? Math.min(100, (current / target) * 100) : 0;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <span className="big-number">{commas(current)}</span>
        {known && <span className="label">next: {commas(target)}</span>}
      </div>
      <div
        className="milestone-track"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || "Progress to next milestone"}
      >
        <div className="milestone-fill" style={{ width: `${pct}%` }} />
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ perk lock */

export function PerkLock({ perk, benefit }: { perk: string; benefit: string }) {
  return (
    <div className="perk-lock">
      <BoneGlyph size={16} />
      <span>
        <strong>{perk}</strong> — {benefit}
      </span>
      <a href={STAKING_URL} target="_blank" rel="noreferrer">
        stake to unlock →
      </a>
    </div>
  );
}

/* ---------------------------------------------------------- empty state */

export function EmptyState({
  kind = "empty",
  message,
  action,
}: {
  kind?: "loading" | "empty" | "error" | "offline";
  message: string;
  action?: React.ReactNode;
}) {
  const heading = {
    loading: "reading the field",
    empty: "nothing here yet",
    error: "that didn't work",
    offline: "you're offline",
  }[kind];

  return (
    <div className="empty">
      <span className={`label ${kind === "error" ? "tone-bad" : ""}`}>{heading}</span>
      <span className={kind === "loading" ? "loading-caption" : ""}>{message}</span>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------- celebration */

const CONFETTI_COLORS = ["var(--accent)", "var(--rust)", "var(--good)", "var(--text)"];

export function Celebration({
  stamp,
  detail,
  onClose,
}: {
  stamp: string;
  detail?: string;
  onClose: () => void;
}) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, index) => ({
        id: index,
        left: `${(index * 37) % 100}%`,
        delay: `${(index % 10) * 90}ms`,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(onClose, 4200);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="celebration" role="dialog" aria-live="assertive" onClick={onClose}>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti"
          style={{ left: piece.left, animationDelay: piece.delay, background: piece.color }}
        />
      ))}
      <div className="celebration-card">
        <div className="serif" style={{ fontSize: 30, fontWeight: 700 }}>
          {stamp}
        </div>
        {detail && <p className="muted" style={{ margin: "8px 0 0" }}>{detail}</p>}
        <button className="btn" style={{ marginTop: 18 }} onClick={onClose}>
          nice
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- rank progress */

export function RankProgress({ gbp }: { gbp: number }) {
  const rank = rankFor(gbp);
  const next = RANKS.find((candidate) => candidate.threshold > gbp);
  const pct = next
    ? Math.min(100, ((gbp - rank.threshold) / (next.threshold - rank.threshold)) * 100)
    : 100;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={next ? `Progress to ${next.name}` : "Highest rank reached"}
        style={{ ["--rank-color" as any]: `var(--rank-${rank.key})` }}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="label">
        {next
          ? `${commas(next.threshold - gbp)} points to ${next.name}`
          : "top of the ladder — a very good boy"}
      </span>
    </div>
  );
}
