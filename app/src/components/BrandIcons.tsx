/**
 * Real brand marks for the outbound links.
 *
 * The three Solana-side logos are the services' own icon files, downloaded to
 * `public/brands/` rather than hotlinked — hotlinking would leak every
 * visitor's IP to three third parties and break the page whenever one of them
 * reorganises their assets. They are used only to label links pointing at
 * those same services, which is what the marks are for.
 *
 * X is drawn inline instead. Its mark is two strokes, so it reproduces exactly,
 * and as a path it inherits `currentColor` — which matters because it is the
 * one logo here that is pure monochrome and would otherwise be a black glyph
 * on a near-black header.
 */

const FILES: Record<string, string> = {
  pumpfun: "/brands/pumpfun.png",
  dexscreener: "/brands/dexscreener.png",
  solscan: "/brands/solscan.png",
};

const NAMES: Record<string, string> = {
  x: "X",
  pumpfun: "pump.fun",
  dexscreener: "DexScreener",
  solscan: "Solscan",
};

export function BrandMark({ id, size = 18 }: { id: string; size?: number }) {
  if (id === "x") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12.6 1.5h2.3l-5 5.8 5.9 7.8h-4.6l-3.6-4.7-4.1 4.7H1.1l5.4-6.2L.9 1.5h4.7l3.3 4.3 3.7-4.3Zm-.8 12.2h1.3L4.6 2.8H3.2l8.6 10.9Z" />
      </svg>
    );
  }

  const src = FILES[id];
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ display: "block", borderRadius: 3 }}
    />
  );
}

/** Human name for a brand id, used for tooltips and screen-reader labels. */
export const brandName = (id: string) => NAMES[id] ?? id;

/** Link labels in the token cards map onto the same ids. */
export const brandIdFor = (label: string) =>
  label.toLowerCase().replace(/[^a-z]/g, "");
