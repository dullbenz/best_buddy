/**
 * A vignette per game.
 *
 * The arcade grid was showing the same dog six times, which made six different
 * games look like one. Each of these says what its game *is* at a glance: a
 * thrown ball, a hurdled rug, a buried bone. Drawn in the same hand as the
 * claim site's diagrams — sketchy strokes, palette variables, no image files.
 */
import React from "react";

import { BuddySprite, BuddyFace } from "./buddy/BuddySprite";
import { BONE_PATH } from "./buddy/poses";

const STROKE = { stroke: "var(--muted)", strokeWidth: 1.6, fill: "none" } as const;

/** Pet: Buddy face-on with hearts coming off him. */
export function ArtPet() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      {/* A nested <svg> is legal and keeps Buddy's own viewBox intact. */}
      <g transform="translate(34, 2) scale(0.72)">
        <BuddyFace size={70} />
      </g>
      {[
        { x: 20, y: 30, s: 1 },
        { x: 100, y: 22, s: 0.75 },
        { x: 12, y: 54, s: 0.6 },
      ].map((heart, index) => (
        <path
          key={index}
          transform={`translate(${heart.x}, ${heart.y}) scale(${heart.s})`}
          d="M8 14S0 8.6 0 4.4A4.6 4.6 0 0 1 8 1a4.6 4.6 0 0 1 8 3.4C16 8.6 8 14 8 14z"
          fill="var(--rust)"
          opacity={0.75}
        />
      ))}
    </svg>
  );
}

/** Fetch: the arc of a thrown ball, with Buddy under the landing spot. */
export function ArtFetch() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      <line x1="6" y1="66" x2="114" y2="66" stroke="var(--border)" strokeWidth="1.4" />
      <path d="M10 62 Q56 4 104 60" {...STROKE} strokeDasharray="3 4" />
      <circle cx="104" cy="60" r="4.5" fill="var(--accent)" />
      <g transform="translate(52, 30) scale(0.36)">
        <BuddySprite pose="run" size={100} />
      </g>
    </svg>
  );
}

/** Runner: Buddy mid-jump over a rolled rug. */
export function ArtRunner() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      <line x1="6" y1="66" x2="114" y2="66" stroke="var(--border)" strokeWidth="1.4" />
      <path d="M22 60 Q50 22 82 58" {...STROKE} strokeDasharray="3 4" />
      <g transform="translate(38, 8) scale(0.34)">
        <BuddySprite pose="jump" size={100} />
      </g>
      <g>
        <rect x="74" y="50" width="26" height="16" rx="7" fill="var(--rust)" />
        <line x1="81" y1="52" x2="81" y2="64" stroke="var(--panel)" strokeWidth="1.4" />
        <line x1="88" y1="52" x2="88" y2="64" stroke="var(--panel)" strokeWidth="1.4" />
      </g>
    </svg>
  );
}

/** Hunt: a bone half-buried in a mound, with a dotted trail to it. */
export function ArtHunt() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      <line x1="6" y1="62" x2="114" y2="62" stroke="var(--border)" strokeWidth="1.4" />
      <path d="M14 58 Q34 44 52 56 T96 48" {...STROKE} strokeDasharray="2 5" />
      <path d="M64 62 Q78 40 96 62 Z" fill="var(--panel-2)" stroke="var(--border)" strokeWidth="1.4" />
      <g transform="translate(66, 40) scale(0.62) rotate(-18)">
        <path d={BONE_PATH} fill="var(--accent)" />
      </g>
      <g transform="translate(6, 26) scale(0.3)">
        <BuddySprite pose="dig" size={100} />
      </g>
    </svg>
  );
}

/** Tournament: two bones crossed. */
export function ArtTournament() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      <g transform="translate(18, 16) rotate(28) scale(0.82)">
        <path d={BONE_PATH} fill="var(--rust)" />
      </g>
      <g transform="translate(22, 60) rotate(-28) scale(0.82)">
        <path d={BONE_PATH} fill="var(--accent)" />
      </g>
      <text
        x="60"
        y="44"
        textAnchor="middle"
        fontFamily="var(--mono)"
        fontSize="13"
        fontWeight="700"
        fill="var(--muted)"
      >
        VS
      </text>
    </svg>
  );
}

/** Ranks: a ladder of bones, the top one lit. */
export function ArtRanks() {
  return (
    <svg viewBox="0 0 120 76" width={132} height={84} aria-hidden="true">
      {[0, 1, 2, 3].map((step) => (
        <g key={step} transform={`translate(${18 + step * 22}, ${58 - step * 13}) scale(0.5)`}>
          <path
            d={BONE_PATH}
            fill={step === 3 ? "var(--accent)" : "var(--muted)"}
            opacity={step === 3 ? 1 : 0.35 + step * 0.15}
          />
        </g>
      ))}
      <path d="M18 62 L100 20" {...STROKE} strokeDasharray="2 4" />
    </svg>
  );
}
