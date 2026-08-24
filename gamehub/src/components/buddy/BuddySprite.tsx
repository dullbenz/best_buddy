/**
 * Buddy, drawn.
 *
 * Layered inline SVG rather than a sprite sheet: it inherits the theme's colours
 * through CSS custom properties, stays crisp at any size, animates with CSS, and
 * adds nothing to the download. The same approach the claim site's diagrams use.
 *
 * Poses are CSS classes on the root, so a pose change is a transition rather
 * than a swap — and `prefers-reduced-motion` turns the lot off in one place.
 */
import React from "react";
import { SIDE, FRONT, type Pose } from "./poses";

export function BuddySprite({
  pose = "idle",
  size = 120,
  golden = false,
  className = "",
  title,
}: {
  pose?: Pose;
  size?: number;
  golden?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`buddy buddy-${pose} ${golden ? "buddy-golden" : ""} ${className}`}
      role="img"
      aria-label={title || `Buddy, ${pose}`}
    >
      <title>{title || `Buddy, ${pose}`}</title>
      <g className="buddy-tail">
        <path d={SIDE.tail} />
      </g>
      <g className="buddy-legs-back">
        <path d={SIDE.legRearBack} />
        <path d={SIDE.legFrontBack} />
      </g>
      <path className="buddy-body" d={SIDE.body} />
      <g className="buddy-legs-front">
        <path d={SIDE.legRearUpper} />
        <path d={SIDE.legFrontUpper} />
      </g>
      <path className="buddy-collar" d={SIDE.collar} />
      <g className="buddy-head">
        <path className="buddy-body" d={SIDE.head} />
        <path className="buddy-snout" d={SIDE.snout} />
        <g className="buddy-ear">
          <path d={SIDE.ear} />
        </g>
        <circle className="buddy-eye" cx="84" cy="31" r="2.6" />
      </g>
    </svg>
  );
}

/**
 * Front-facing Buddy for the pet page: the one screen where he is the subject
 * rather than a participant, so he gets eye contact.
 */
export function BuddyFace({
  size = 260,
  happy = 0,
  golden = false,
  className = "",
}: {
  size?: number;
  /** 0 = resting, rises briefly with each pet. */
  happy?: number;
  golden?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`buddy-face ${golden ? "buddy-golden" : ""} ${className}`}
      style={{ ["--happy" as any]: happy }}
      role="img"
      aria-label="Buddy"
    >
      <title>Buddy</title>
      <g className="face-ear face-ear-left">
        <path d={FRONT.earLeft} />
      </g>
      <g className="face-ear face-ear-right">
        <path d={FRONT.earRight} />
      </g>
      <path className="face-head" d={FRONT.head} />
      <path className="face-patch" d={FRONT.patch} />
      <path className="face-muzzle" d={FRONT.muzzle} />
      <g className="face-eyes">
        <path className="face-eye" d={FRONT.eyeLeft} />
        <path className="face-eye" d={FRONT.eyeRight} />
      </g>
      <path className="face-nose" d={FRONT.nose} />
      <path className="face-tongue" d={FRONT.tongue} />
    </svg>
  );
}
