/**
 * The fetch field.
 *
 * Drag back and up to set power and lift, release to throw. The dotted preview
 * arc is computed by running the real simulation on the real seed — the same
 * function the server will score the throw with — so what you aim at is exactly
 * what you get. Nothing here estimates anything.
 *
 * There is a full keyboard mode, and it is not an afterthought: hold space to
 * swing the power meter, arrows to trim the angle, release to throw. Everything
 * the pointer can do it can do.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { simulateThrow } from "@game-core/fetch-sim.js";
import { BuddySprite } from "../../components/buddy/BuddySprite";
import type { Field, ThrowResult } from "../../lib/api";
import { THROW_Q_MAX } from "../../config";

/** World-space extents, chosen to frame every reachable throw. */
const WORLD_X = 30000;
const WORLD_Y = 13000;
const VIEW_W = 1000;
const VIEW_H = 300;
const GROUND_Y = 244;
const THROWER_X = 44;

const toScreenX = (worldX: number) => THROWER_X + (worldX / WORLD_X) * (VIEW_W - THROWER_X - 30);
const toScreenY = (worldY: number) => GROUND_Y - (worldY / WORLD_Y) * (GROUND_Y - 34);

/** Ball height at a tick, from the same physics the sim integrates. */
function heightAt(vy: number, gravity: number, tick: number) {
  return vy * tick - (gravity * tick * tick) / 2;
}

function trajectoryPath(flight: { vx: number; vy: number; flightTicks: number; gravity: number }, wind: number) {
  const points: string[] = [];
  const steps = Math.max(6, Math.min(60, flight.flightTicks));
  for (let step = 0; step <= steps; step++) {
    const tick = (flight.flightTicks * step) / steps;
    const x = (flight.vx + wind) * tick;
    const y = Math.max(0, heightAt(flight.vy, flight.gravity, tick));
    points.push(`${toScreenX(x).toFixed(1)},${toScreenY(y).toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
}

export type Aim = { angleQ: number; powerQ: number };

export function FetchStage({
  seed,
  throwIndex,
  field,
  mode,
  disabled,
  result,
  onThrow,
  practice,
}: {
  seed: string;
  throwIndex: number;
  field: Field;
  mode: "normal" | "golden";
  disabled: boolean;
  /** Set once the server has scored; drives the flight animation. */
  result: ThrowResult | null;
  onThrow: (aim: Aim) => void;
  practice?: boolean;
}) {
  const [aim, setAim] = useState<Aim>({ angleQ: 32000, powerQ: 38000 });
  const [dragging, setDragging] = useState(false);
  const [charging, setCharging] = useState(false);
  const [animTick, setAnimTick] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  /** The throw the current aim would produce, from the authoritative sim. */
  const preview = useMemo(
    () => simulateThrow(seed, throwIndex, aim, { mode }),
    [seed, throwIndex, aim, mode],
  );

  /* ------------------------------- pointer ------------------------------- */

  const pointToAim = useCallback((clientX: number, clientY: number) => {
    if (!origin.current) return;
    const dx = origin.current.x - clientX;
    const dy = origin.current.y - clientY;
    // Drag back (and up) from the throw point: distance is power, the angle of
    // the drag is lift. Pulling forward does nothing rather than throwing
    // backwards, which would just be confusing.
    const distance = Math.min(220, Math.max(0, Math.hypot(Math.max(0, dx), Math.max(0, dy))));
    const radians = Math.atan2(Math.max(0, dy), Math.max(1, Math.max(0, dx)));
    const degrees = (radians * 180) / Math.PI;

    setAim({
      powerQ: Math.round((distance / 220) * THROW_Q_MAX),
      angleQ: Math.round((Math.min(80, Math.max(5, degrees)) / 85) * THROW_Q_MAX),
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (disabled) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    pointToAim(event.clientX, event.clientY);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    origin.current = null;
    onThrow(aim);
  };

  /* ------------------------------ keyboard ------------------------------- */

  /**
   * The listeners are attached once and read the live values through refs.
   *
   * Depending on `aim` here would re-subscribe on every animation frame while
   * the power meter is swinging — sixty add/remove pairs a second — and, worse,
   * leave a gap on each re-attach. A key pressed the instant the stage
   * re-enables would land in one of those gaps and do nothing, which reads as
   * an unresponsive game.
   */
  const aimRef = useRef(aim);
  aimRef.current = aim;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onThrowRef = useRef(onThrow);
  onThrowRef.current = onThrow;

  useEffect(() => {
    let raf = 0;
    let direction = 1;
    let chargingNow = false;

    const sweep = () => {
      setAim((current) => {
        let next = current.powerQ + direction * 1400;
        if (next >= THROW_Q_MAX) {
          next = THROW_Q_MAX;
          direction = -1;
        } else if (next <= 0) {
          next = 0;
          direction = 1;
        }
        return { ...current, powerQ: next };
      });
      raf = requestAnimationFrame(sweep);
    };

    const stopSweep = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      chargingNow = false;
      setCharging(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (disabledRef.current) return;

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        setAim((current) => ({
          ...current,
          angleQ: Math.max(
            0,
            Math.min(THROW_Q_MAX, current.angleQ + (event.key === "ArrowUp" ? 2600 : -2600)),
          ),
        }));
        return;
      }

      if (event.key === " " && !chargingNow) {
        // Also stops the space bar from re-activating whatever button was last
        // clicked, which would otherwise swallow the throw.
        event.preventDefault();
        chargingNow = true;
        setCharging(true);
        raf = requestAnimationFrame(sweep);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !chargingNow) return;
      event.preventDefault();
      stopSweep();
      if (!disabledRef.current) onThrowRef.current(aimRef.current);
    };

    // A key held while the window loses focus would otherwise stay "down".
    const onBlur = () => {
      if (chargingNow) stopSweep();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* ----------------------------- flight anim ----------------------------- */

  useEffect(() => {
    if (!result) {
      setAnimTick(null);
      return undefined;
    }
    const ticks = result.flight.flightTicks;
    const durationMs = (ticks / 60) * 1000;
    const startedAt = performance.now();
    let raf = 0;

    const step = (stamp: number) => {
      const progress = Math.min(1, (stamp - startedAt) / durationMs);
      setAnimTick(progress * ticks);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  /* ------------------------------- render -------------------------------- */

  const shown = result ?? preview;
  const wind = field.windPerTick;
  const landing = shown.flight.landingX;

  // Where the ball is right now, mid-flight.
  const tick = animTick ?? 0;
  const ballWorldX = result ? (result.flight.vx + wind) * tick : 0;
  const ballWorldY = result ? Math.max(0, heightAt(result.flight.vy, result.flight.gravity, tick)) : 0;

  // Buddy sprints toward where it will land, capped by how far he can get.
  const buddyStart = field.buddyStartX;
  const toward = Math.sign(landing - buddyStart);
  const covered = result ? Math.min(Math.abs(landing - buddyStart), 340 * tick) : 0;
  const buddyWorldX = buddyStart + toward * covered;

  const flying = result !== null && tick < result.flight.flightTicks;
  const caught = result && !flying && result.grade !== "miss";

  return (
    <div className="stage">
      {practice && <div className="stage-note">practice</div>}
      {mode === "golden" && !practice && <div className="stage-note">golden bone</div>}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ display: "block", width: "100%", height: "auto", cursor: disabled ? "default" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Fetch field. Hold space to swing the power meter, up and down arrows to set the angle, release to throw."
      >
        {/* Ground, with distance ticks — the claim site's ruler idiom. */}
        <line x1="0" y1={GROUND_Y} x2={VIEW_W} y2={GROUND_Y} stroke="var(--border)" strokeWidth="1.5" />
        {Array.from({ length: 11 }, (_, index) => {
          const worldX = (WORLD_X / 10) * index;
          const x = toScreenX(worldX);
          return (
            <g key={index}>
              <line x1={x} y1={GROUND_Y} x2={x} y2={GROUND_Y + (index % 5 === 0 ? 9 : 5)} stroke="var(--border)" />
              {index % 5 === 0 && (
                <text
                  x={x}
                  y={GROUND_Y + 22}
                  fill="var(--muted)"
                  fontSize="9"
                  fontFamily="var(--mono)"
                  textAnchor="middle"
                >
                  {Math.round(worldX / 256)}m
                </text>
              )}
            </g>
          );
        })}

        {/* Wind, when there is any worth showing. Kept top-left: the corner
            opposite is where the practice / golden-bone chip lives. */}
        {Math.abs(wind) > 4 && (
          <g opacity="0.75">
            <text x="14" y="24" fill="var(--muted)" fontSize="10" fontFamily="var(--mono)">
              wind {wind > 0 ? "\u2192" : "\u2190"} {Math.abs(wind)}
            </text>
          </g>
        )}

        {/* Where Buddy can reach: the band you are aiming into. */}
        {!result && (
          <g opacity="0.5">
            <line
              x1={toScreenX(Math.max(0, buddyStart - shown.buddy.reach))}
              y1={GROUND_Y - 4}
              x2={toScreenX(buddyStart + shown.buddy.reach)}
              y2={GROUND_Y - 4}
              stroke="var(--accent-dim)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Preview arc while aiming; the flown arc afterwards. */}
        <path
          d={trajectoryPath(shown.flight, wind)}
          fill="none"
          stroke={result ? "var(--accent)" : "var(--muted)"}
          strokeWidth="1.6"
          strokeDasharray={result ? "none" : "3 5"}
          opacity={result ? 0.5 : 0.85}
        />

        {/* The landing spot, marked while aiming. */}
        {!result && (
          <circle cx={toScreenX(landing)} cy={GROUND_Y} r="4" fill="none" stroke="var(--accent)" strokeWidth="1.4" />
        )}

        {/* The ball. */}
        {result && (
          <circle
            cx={toScreenX(ballWorldX)}
            cy={toScreenY(ballWorldY)}
            r="6"
            fill={mode === "golden" ? "var(--accent)" : "var(--text)"}
          />
        )}

        {/* Buddy. */}
        <g transform={`translate(${toScreenX(buddyWorldX) - 26}, ${GROUND_Y - 52})`}>
          <BuddySprite
            size={56}
            golden={mode === "golden"}
            pose={
              flying ? "run" : caught ? "catch" : result?.grade === "miss" ? "miss" : "idle"
            }
            title={flying ? "Buddy sprinting for the ball" : "Buddy waiting"}
          />
        </g>

        {/* The thrower's mark. */}
        <circle cx={THROWER_X} cy={GROUND_Y - 8} r="3" fill="var(--muted)" />
      </svg>

      {/* Aim readout, doubling as the keyboard mode's display. */}
      {!disabled && !result && (
        <div
          className="row"
          // Present only while the stage is accepting a throw, which makes it
          // the readiness signal the end-to-end suite synchronises on.
          data-testid="aim-readout"
          style={{ padding: "10px 14px 12px", borderTop: "1px solid var(--border)", gap: 16 }}
        >
          <span className="label">power</span>
          <div className="milestone-track" style={{ flex: 1, minWidth: 90 }}>
            <div className="milestone-fill" style={{ width: `${(aim.powerQ / THROW_Q_MAX) * 100}%` }} />
          </div>
          <span className="label">lift</span>
          <div className="milestone-track" style={{ flex: 1, minWidth: 90 }}>
            <div className="milestone-fill" style={{ width: `${(aim.angleQ / THROW_Q_MAX) * 100}%` }} />
          </div>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {dragging || charging ? "release to throw" : "drag back · or hold space"}
          </span>
        </div>
      )}

      {result && !flying && (
        <div className={`verdict verdict-${result.grade}`}>
          <span>{result.label}</span>
        </div>
      )}
    </div>
  );
}
