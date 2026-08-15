/**
 * Hand-drawn SVG diagrams for the landing page.
 *
 * Every one of these exists because a specific idea does not survive being
 * written as a sentence. "A 30-day stream behind a cliff" means nothing to
 * someone new; the same thing as a shape on a time axis is understood in about
 * a second. Nothing here is decorative — if a diagram were removed, the
 * paragraph next to it would get harder to understand, which is the test.
 *
 * All of them are inline, use CSS custom properties so they follow the theme,
 * scale by viewBox, and carry a <title> for screen readers. No image files, no
 * chart library, nothing to load.
 */

const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

/* ------------------------------------------------------------------ *
 * Why a community takeover of the Legacy Buddy coin was impossible.
 * Before/after, because the whole argument is a comparison.
 * ------------------------------------------------------------------ */
export function FeeTrapDiagram() {
  return (
    <svg
      className="l-svg"
      viewBox="0 0 440 260"
      role="img"
      aria-labelledby="feetrap-title"
      style={{ maxWidth: 460 }}
    >
      {/* --- old --- */}
      <text x="0" y="14" fill="var(--muted)" fontSize="11" fontFamily={MONO} letterSpacing="1.6">
        LEGACY $BUDDY
      </text>

      <rect x="0" y="30" width="120" height="44" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="60" y="57" fill="var(--text)" fontSize="13" textAnchor="middle">
        Every trade
      </text>

      <line x1="120" y1="52" x2="196" y2="52" stroke="var(--rust)" strokeWidth="1.5" />
      <path d="M196 52 l-7 -4 v8 z" fill="var(--rust)" />
      <text x="158" y="43" fill="var(--rust)" fontSize="10.5" textAnchor="middle" fontFamily={MONO} letterSpacing="1.2">
        FEE
      </text>

      <rect x="200" y="30" width="150" height="44" rx="2" fill="var(--panel-2)" stroke="var(--rust)" />
      <text x="275" y="51" fill="var(--text)" fontSize="13" textAnchor="middle">
        The creator
      </text>
      <text x="275" y="66" fill="var(--muted)" fontSize="11" textAnchor="middle">
        who had already left
      </text>

      {/* divider */}
      <line x1="0" y1="120" x2="440" y2="120" stroke="var(--border)" strokeDasharray="3 4" />

      {/* --- new --- */}
      <text x="0" y="146" fill="var(--accent)" fontSize="11" fontFamily={MONO} letterSpacing="1.6">
        THIS COIN
      </text>

      <rect x="0" y="162" width="120" height="44" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="60" y="189" fill="var(--text)" fontSize="13" textAnchor="middle">
        Every trade
      </text>

      <line x1="120" y1="184" x2="196" y2="184" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M196 184 l-7 -4 v8 z" fill="var(--accent)" />
      <text x="158" y="175" fill="var(--accent)" fontSize="10.5" textAnchor="middle" fontFamily={MONO} letterSpacing="1.2">
        90%
      </text>

      <rect x="200" y="162" width="150" height="44" rx="2" fill="var(--panel-2)" stroke="var(--accent)" />
      <text x="275" y="183" fill="var(--text)" fontSize="13" textAnchor="middle">
        The staking pool
      </text>
      <text x="275" y="198" fill="var(--muted)" fontSize="11" textAnchor="middle">
        anyone can trigger it
      </text>

      <text x="0" y="230" fill="var(--muted)" fontSize="12">
        The remaining 10% goes to the team.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * The four buckets emptying into the staking pool. This is the single
 * most important idea on the page, so it gets the biggest drawing.
 * ------------------------------------------------------------------ */
export function BucketFlowDiagram() {
  const boxes = [
    { label: "Legacy holders", sub: "30 days" },
    { label: "Influencers", sub: "72 hours" },
    { label: "2014 signer", sub: "until 2030" },
    { label: "The builder", sub: "12 months" },
  ];

  return (
    <svg
      className="l-svg"
      viewBox="0 0 440 330"
      role="img"
      aria-labelledby="flow-title"
      style={{ maxWidth: 470 }}
    >
      <title id="flow-title">
        Each of the four allocations has a deadline. Whatever is not claimed by
        then flows into the community staking pool, along with trading fees and
        donations.
      </title>

      {boxes.map((b, i) => {
        const y = 8 + i * 50;
        return (
          <g key={b.label}>
            <rect x="0" y={y} width="180" height="38" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
            <text x="12" y={y + 17} fill="var(--text)" fontSize="12.5">
              {b.label}
            </text>
            <text x="12" y={y + 31} fill="var(--muted)" fontSize="10.5" fontFamily={MONO} letterSpacing="1">
              {b.sub}
            </text>
            {/* elbow into the spine */}
            <path
              d={`M180 ${y + 19} H 214 V 268`}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
            />
          </g>
        );
      })}

      <text x="228" y="120" fill="var(--muted)" fontSize="11" fontFamily={MONO} letterSpacing="1.2">
        WHATEVER IS
      </text>
      <text x="228" y="135" fill="var(--muted)" fontSize="11" fontFamily={MONO} letterSpacing="1.2">
        NOT CLAIMED
      </text>

      {/* side inputs */}
      <rect x="272" y="18" width="168" height="34" rx="2" fill="none" stroke="var(--border)" strokeDasharray="3 3" />
      <text x="356" y="39" fill="var(--muted)" fontSize="11.5" textAnchor="middle">
        Trading fees
      </text>
      <rect x="272" y="62" width="168" height="34" rx="2" fill="none" stroke="var(--border)" strokeDasharray="3 3" />
      <text x="356" y="83" fill="var(--muted)" fontSize="11.5" textAnchor="middle">
        Donations, from anyone
      </text>
      <path d="M356 96 V 268" fill="none" stroke="var(--border)" strokeDasharray="3 3" />

      {/* arrow into the pool */}
      <path d="M214 268 l-4 -8 h8 z" fill="var(--accent)" transform="translate(0,4)" />
      <path d="M356 268 l-4 -8 h8 z" fill="var(--border)" transform="translate(0,4)" />

      {/* the pool */}
      <rect x="0" y="272" width="440" height="52" rx="2" fill="var(--panel-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="220" y="296" fill="var(--accent)" fontSize="14.5" textAnchor="middle" fontWeight="600">
        The community staking pool
      </text>
      <text x="220" y="313" fill="var(--muted)" fontSize="11.5" textAnchor="middle">
        starts empty · grows forever · never returns to the team
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * What "instant", "stream" and "cliff" actually mean, as shapes.
 * Cumulative tokens received, against time.
 * ------------------------------------------------------------------ */
function PayoutShape({
  title,
  sub,
  path,
  accent,
}: {
  title: string;
  sub: string;
  path: string;
  accent?: boolean;
}) {
  return (
    <figure className="l-shape">
      <svg viewBox="0 0 150 86" role="img" aria-label={`${title}: ${sub}`}>
        {/* axes */}
        <line x1="18" y1="8" x2="18" y2="66" stroke="var(--border)" />
        <line x1="18" y1="66" x2="142" y2="66" stroke="var(--border)" />
        <text x="4" y="14" fill="var(--muted)" fontSize="8" fontFamily={MONO}>
          ALL
        </text>
        <text x="8" y="76" fill="var(--muted)" fontSize="8" fontFamily={MONO}>
          TIME →
        </text>
        <path
          d={path}
          fill="none"
          stroke={accent ? "var(--accent)" : "var(--text)"}
          strokeWidth="2"
        />
      </svg>
      <figcaption>
        <strong>{title}</strong>
        <span>{sub}</span>
      </figcaption>
    </figure>
  );
}

export function PayoutShapes() {
  return (
    <div className="l-shapes">
      <PayoutShape
        title="Instant"
        sub="Legacy Buddy holders. It all arrives the moment you claim."
        path="M18 66 V 12 H 142"
        accent
      />
      <PayoutShape
        title="Stream"
        sub="Influencers. A little more becomes yours every day for 30 days."
        path="M18 66 L 142 12"
      />
      <PayoutShape
        title="Cliff, then stream"
        sub="The builder. Nothing at all at first, then daily across a year."
        path="M18 66 H 52 L 142 12"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Upgrade authority: the thing almost nobody checks.
 * ------------------------------------------------------------------ */
export function AuthorityDiagram() {
  return (
    <svg
      className="l-svg"
      viewBox="0 0 440 150"
      role="img"
      aria-labelledby="auth-title"
      style={{ maxWidth: 460 }}
    >
      <title id="auth-title">
        Normally the holder of the upgrade authority can replace a contract's
        code. Here that authority has been destroyed, so nobody can.
      </title>

      <text x="0" y="12" fill="var(--muted)" fontSize="11" fontFamily={MONO} letterSpacing="1.6">
        NORMALLY
      </text>
      <rect x="0" y="24" width="112" height="38" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="56" y="47" fill="var(--text)" fontSize="12" textAnchor="middle">
        Whoever holds
      </text>
      <line x1="112" y1="43" x2="168" y2="43" stroke="var(--muted)" strokeWidth="1.5" />
      <path d="M168 43 l-7 -4 v8 z" fill="var(--muted)" />
      <text x="140" y="35" fill="var(--muted)" fontSize="10" textAnchor="middle" fontFamily={MONO}>
        KEY
      </text>
      <rect x="172" y="24" width="150" height="38" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="247" y="47" fill="var(--text)" fontSize="12" textAnchor="middle">
        can replace the code
      </text>
      <text x="332" y="47" fill="var(--muted)" fontSize="12">
        …and every rule in it.
      </text>

      <line x1="0" y1="84" x2="440" y2="84" stroke="var(--border)" strokeDasharray="3 4" />

      <text x="0" y="106" fill="var(--accent)" fontSize="11" fontFamily={MONO} letterSpacing="1.6">
        HERE
      </text>
      <rect x="0" y="112" width="112" height="34" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="56" y="133" fill="var(--muted)" fontSize="12" textAnchor="middle">
        Nobody
      </text>
      {/* severed link */}
      <line x1="112" y1="129" x2="140" y2="129" stroke="var(--border)" strokeWidth="1.5" />
      <line x1="152" y1="129" x2="168" y2="129" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="2 3" />
      <line x1="138" y1="120" x2="154" y2="138" stroke="var(--rust)" strokeWidth="1.5" />
      <line x1="154" y1="120" x2="138" y2="138" stroke="var(--rust)" strokeWidth="1.5" />
      <rect x="172" y="112" width="150" height="34" rx="2" fill="var(--panel-2)" stroke="var(--accent)" />
      <text x="247" y="133" fill="var(--accent)" fontSize="12" textAnchor="middle" fontFamily={MONO}>
        Authority: none
      </text>
      <text x="332" y="133" fill="var(--muted)" fontSize="12">
        Permanent.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * How the holder list stays honest without being trusted.
 * ------------------------------------------------------------------ */
export function SnapshotDiagram() {
  const leaves = ["wallet", "wallet", "wallet", "wallet"];
  return (
    <svg
      className="l-svg"
      viewBox="0 0 440 170"
      role="img"
      aria-labelledby="snap-title"
      style={{ maxWidth: 460 }}
    >
      <title id="snap-title">
        Every wallet and amount is combined into a single fingerprint. That
        fingerprint is stored in the contract, so a changed list produces a
        different fingerprint and is caught immediately.
      </title>

      {leaves.map((l, i) => {
        const x = i * 108;
        return (
          <g key={i}>
            <rect x={x} y="6" width="92" height="30" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
            <text x={x + 46} y="25" fill="var(--muted)" fontSize="11" textAnchor="middle">
              {l} + amount
            </text>
            <path
              d={`M${x + 46} 36 V 54 H ${i < 2 ? 100 : 316} V 62`}
              fill="none"
              stroke="var(--border)"
            />
          </g>
        );
      })}

      <rect x="46" y="62" width="108" height="28" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <rect x="262" y="62" width="108" height="28" rx="2" fill="var(--panel-2)" stroke="var(--border)" />
      <text x="100" y="80" fill="var(--muted)" fontSize="10.5" textAnchor="middle" fontFamily={MONO}>
        COMBINED
      </text>
      <text x="316" y="80" fill="var(--muted)" fontSize="10.5" textAnchor="middle" fontFamily={MONO}>
        COMBINED
      </text>

      <path d="M100 90 V 108 H 208 V 116" fill="none" stroke="var(--border)" />
      <path d="M316 90 V 108 H 208" fill="none" stroke="var(--border)" />

      <rect x="120" y="116" width="200" height="34" rx="2" fill="var(--panel-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="220" y="137" fill="var(--accent)" fontSize="12.5" textAnchor="middle" fontFamily={MONO}>
        ONE FINGERPRINT
      </text>
      <text x="220" y="164" fill="var(--muted)" fontSize="11.5" textAnchor="middle">
        stored in the contract · change any row and it stops matching
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Small stroke glyphs for the four routes.
 * ------------------------------------------------------------------ */
export function RouteGlyph({ kind }: { kind: "buy" | "claim" | "stake" | "verify" }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "l-glyph",
  };

  if (kind === "buy")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v9M9.6 9.8h4a1.8 1.8 0 0 1 0 3.6h-3.2a1.8 1.8 0 0 0 0 3.6h4" />
      </svg>
    );
  if (kind === "claim")
    return (
      <svg {...common}>
        <rect x="3" y="6.5" width="18" height="12" rx="2" />
        <path d="M3 10.5h18M16.5 14.5h1.5" />
      </svg>
    );
  if (kind === "stake")
    return (
      <svg {...common}>
        <rect x="5" y="10.5" width="14" height="9" rx="1.5" />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14v2" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4L20 20M8 10.5l1.8 1.8 3.4-3.4" />
    </svg>
  );
}
