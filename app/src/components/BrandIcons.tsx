/**
 * Glyphs for the outbound links.
 *
 * X gets its real mark — it is two strokes and can be reproduced exactly.
 * The other three do not: pump.fun, DexScreener and Solscan all have wordmarks
 * or lettering that cannot be drawn faithfully at 16px from memory, and a bad
 * imitation of a brand is worse than no imitation. They get honest, apt glyphs
 * instead, and every link carries its name in text beside the icon, so nothing
 * depends on recognising a shape.
 *
 * All of them inherit `currentColor` and size from the parent, so hover and
 * disabled states are handled entirely in CSS.
 */

const base = {
  width: 15,
  height: 15,
  viewBox: "0 0 16 16",
  "aria-hidden": true,
  focusable: false,
} as const;

export function IconX() {
  return (
    <svg {...base} fill="currentColor">
      <path d="M12.6 1.5h2.3l-5 5.8 5.9 7.8h-4.6l-3.6-4.7-4.1 4.7H1.1l5.4-6.2L.9 1.5h4.7l3.3 4.3 3.7-4.3Zm-.8 12.2h1.3L4.6 2.8H3.2l8.6 10.9Z" />
    </svg>
  );
}

/** A bonding curve: the thing pump.fun actually is. */
export function IconPumpFun() {
  return (
    <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 13.2c3.6 0 6.1-1.4 8-4.1 1.3-1.8 2.4-3.9 3.2-6.3" />
      <path d="M10.2 2.4h3.2v3.2" />
    </svg>
  );
}

/** Candlesticks — the universal shorthand for a price chart. */
export function IconDexScreener() {
  return (
    <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 2.2v2M4 11.8v2M12 1.6v3M12 10.4v3" />
      <rect x="2.2" y="4.2" width="3.6" height="7.6" rx="1" />
      <rect x="10.2" y="4.6" width="3.6" height="5.8" rx="1" />
    </svg>
  );
}

/** A magnifier over a block: scanning the chain. */
export function IconSolscan() {
  return (
    <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.9" cy="6.9" r="4.6" />
      <path d="M10.4 10.4 14 14" />
    </svg>
  );
}

export const BRAND_ICONS: Record<string, () => JSX.Element> = {
  x: IconX,
  pumpfun: IconPumpFun,
  dexscreener: IconDexScreener,
  solscan: IconSolscan,
};
