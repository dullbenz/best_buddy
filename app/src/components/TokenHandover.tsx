import { useEffect, useRef, useState } from "react";
import { LEGACY_TOKEN_INFO, NEW_TOKEN_INFO } from "../config";
import { BrandMark, brandIdFor } from "./BrandIcons";

type TokenInfo = typeof LEGACY_TOKEN_INFO | typeof NEW_TOKEN_INFO;

/**
 * One token, as a card.
 *
 * The image is the only thing here that can fail — the artwork is swapped
 * before launch and a missing file must not leave a broken-image glyph on the
 * hero. It falls back to the ticker's initial, which still reads as a token.
 */
function TokenCard({
  token,
  variant,
}: {
  token: TokenInfo;
  variant: "legacy" | "new";
}) {
  const [broken, setBroken] = useState(false);

  return (
    <figure className={`ho-card ho-${variant}`}>
      <div className="ho-art">
        {broken ? (
          <span className="ho-fallback" aria-hidden="true">
            {token.ticker.replace("$", "").charAt(0)}
          </span>
        ) : (
          <img
            src={token.image}
            alt={`${token.name} logo`}
            width="96"
            height="96"
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        )}
      </div>

      <figcaption className="ho-meta">
        <span className="ho-name">{token.name}</span>
        <span className="ho-ticker">{token.ticker}</span>
      </figcaption>

      <div className="ho-links">
        {token.links.map((l) => {
          const id = brandIdFor(l.label);
          return l.url ? (
            <a
              key={l.label}
              className="ho-link"
              href={l.url}
              title={`${token.name} on ${l.label} — ${l.note}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <BrandMark id={id} size={12} />
              <span>{l.label}</span>
            </a>
          ) : (
            <span
              key={l.label}
              className="ho-link is-pending"
              title={`${l.label} — live at launch`}
              aria-disabled="true"
            >
              <BrandMark id={id} size={12} />
              <span>{l.label}</span>
            </span>
          );
        })}
      </div>
    </figure>
  );
}

/**
 * The handover: the story moving from the abandoned token to this one.
 *
 * This is the hero's claim — "same story, but built to last" — drawn rather
 * than asserted. The legacy card is deliberately shown *first and intact*,
 * then settles into a desaturated archival state as the track completes; the
 * point is inheritance, not erasure. Nothing about the old token is hidden,
 * including its still-live market links.
 *
 * Motion runs once, on scroll into view, rather than on mount — the strip sits
 * below a tall hero on small screens and animating out of sight would mean
 * most visitors see only the final frame. `prefers-reduced-motion` skips
 * straight to that final frame, which is the fully legible state anyway.
 */
export function TokenHandover() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver, or motion is unwelcome: render the end state.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="ho" ref={ref} data-shown={shown ? "true" : "false"}>
      <TokenCard token={LEGACY_TOKEN_INFO} variant="legacy" />

      <div className="ho-track" aria-hidden="true">
        <svg viewBox="0 0 120 24" preserveAspectRatio="none" className="ho-rail">
          <path className="ho-rail-line" d="M2 12 H108" />
          {/* Same geometry as the line above, drawn over it as a short bright
              dash. Because it is the stroke rather than an element on top, it
              cannot drift off the wire the way a positioned dot did. */}
          <path className="ho-rail-flow" d="M2 12 H108" />
          <path className="ho-rail-head" d="M104 7 L112 12 L104 17" />
        </svg>
        <span className="ho-track-label">rebuilt as</span>
      </div>

      <TokenCard token={NEW_TOKEN_INFO} variant="new" />
    </div>
  );
}
