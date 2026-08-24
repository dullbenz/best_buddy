/**
 * Buddy vs. The Rugs — the canvas.
 *
 * The simulation is not in here. This drives `createRun` from the shared game
 * core at a fixed 60Hz and draws whatever it says the world looks like, which
 * is the only reason a recorded run replays identically on the server.
 *
 * Fixed timestep with an accumulator, rendering interpolated between steps: on
 * a 144Hz display the physics still advances 60 times a second, and on a slow
 * phone dropping frames the run does not quietly become easier.
 */
import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

import { createRun, RUNNER_ACTIONS, RUNNER_WORLD } from "@game-core/runner-sim.js";
import { sfx } from "../../lib/sfx";

const VIEW_W = 1400;
const VIEW_H = 320;
const GROUND_Y = 262;
const BUDDY_SCREEN_X = 120;
/** One scale for both axes, so the drawing and the hitboxes agree. */
const SCALE = 0.52;
const TICK_MS = 1000 / 60;
/** Never simulate more than this per frame after a long stall. */
const MAX_CATCHUP_TICKS = 8;

export type RunHandle = {
  press: (action: number) => void;
  stop: () => void;
};

export type RunOver = {
  score: number;
  distance: number;
  bones: number;
  inputs: { tick: number; action: number }[];
};

export const RunnerCanvas = forwardRef<RunHandle, {
  seed: string;
  onTick: (state: { score: number; bones: number; distance: number }) => void;
  onOver: (result: RunOver) => void;
}>(function RunnerCanvas({ seed, onTick, onOver }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef<ReturnType<typeof createRun> | null>(null);
  const inputsRef = useRef<{ tick: number; action: number }[]>([]);
  const lastInputTick = useRef(-1);
  const finishedRef = useRef(false);
  const bonesRef = useRef(0);

  useImperativeHandle(ref, () => ({
    press(action: number) {
      const run = runRef.current;
      if (!run || finishedRef.current) return;
      // One input per tick: the wire format requires strictly increasing ticks,
      // and two actions in the same 16ms are indistinguishable anyway.
      if (run.tick === lastInputTick.current) return;
      lastInputTick.current = run.tick;
      inputsRef.current.push({ tick: run.tick, action });
      run.press(action);
      if (action === RUNNER_ACTIONS.JUMP) sfx.jump();
    },
    stop() {
      finishedRef.current = true;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;
    context.scale(dpr, dpr);

    const run = createRun(seed);
    runRef.current = run;
    inputsRef.current = [];
    lastInputTick.current = -1;
    finishedRef.current = false;
    bonesRef.current = 0;

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let paused = false;

    const onVisibility = () => {
      paused = document.hidden;
      // Coming back from a background tab must not fast-forward the run.
      last = performance.now();
      accumulator = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onVisibility);

    const frame = (stamp: number) => {
      raf = requestAnimationFrame(frame);
      const delta = Math.min(250, stamp - last);
      last = stamp;

      if (!paused && !finishedRef.current) {
        accumulator += delta;
        let steps = 0;
        while (accumulator >= TICK_MS && steps < MAX_CATCHUP_TICKS) {
          const before = run.state.bones;
          const alive = run.step();
          if (run.state.bones > before) {
            bonesRef.current = run.state.bones;
            sfx.bone();
          }
          accumulator -= TICK_MS;
          steps++;

          if (!alive) {
            finishedRef.current = true;
            sfx.crash();
            const state = run.state;
            onOver({
              score: run.score(),
              distance: state.distance,
              bones: state.bones,
              inputs: inputsRef.current,
            });
            break;
          }
        }
        // A very long stall would otherwise leave the accumulator huge.
        if (steps >= MAX_CATCHUP_TICKS) accumulator = 0;
        onTick({ score: run.score(), bones: run.state.bones, distance: run.state.distance });
      }

      draw(context, run.state, paused);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
    };
  }, [seed, onOver, onTick]);

  return (
    <canvas
      ref={canvasRef}
      className="runner-canvas"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
      aria-label="Buddy vs. The Rugs. Space or up arrow to jump, down arrow to slide."
      role="application"
    />
  );
});

/* ------------------------------- rendering ------------------------------- */

function cssVar(name: string, fallback: string) {
  if (typeof getComputedStyle === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

let palette: Record<string, string> | null = null;
function colors() {
  if (!palette) {
    palette = {
      text: cssVar("--text", "#ece5d8"),
      muted: cssVar("--muted", "#948a78"),
      accent: cssVar("--accent", "#ffb84d"),
      rust: cssVar("--rust", "#d2764c"),
      bad: cssVar("--bad", "#f0776b"),
      border: cssVar("--border", "#2a2620"),
      panel: cssVar("--panel", "#151310"),
      panel2: cssVar("--panel-2", "#1c1915"),
    };
  }
  return palette;
}

function draw(context: CanvasRenderingContext2D, state: any, paused: boolean) {
  const palette = colors();
  const { distance } = state;

  context.clearRect(0, 0, VIEW_W, VIEW_H);
  context.fillStyle = palette.panel;
  context.fillRect(0, 0, VIEW_W, VIEW_H);

  drawSkyline(context, distance, palette);

  // Ground.
  context.strokeStyle = palette.border;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, GROUND_Y);
  context.lineTo(VIEW_W, GROUND_Y);
  context.stroke();

  // Ground texture, scrolling with the world so the speed reads.
  context.strokeStyle = palette.border;
  context.lineWidth = 1;
  const tickSpacing = 120;
  const offset = (distance * SCALE) % tickSpacing;
  for (let x = -offset; x < VIEW_W; x += tickSpacing) {
    context.beginPath();
    context.moveTo(x, GROUND_Y + 4);
    context.lineTo(x + 30, GROUND_Y + 4);
    context.stroke();
  }

  const worldToScreen = (worldX: number) => BUDDY_SCREEN_X + (worldX - distance) * SCALE;

  for (const obstacle of state.obstacles) {
    const x = worldToScreen(obstacle.x);
    if (x < -160 || x > VIEW_W + 160) continue;
    drawObstacle(context, obstacle, x, palette);
  }

  for (const bone of state.boneItems) {
    const x = worldToScreen(bone.x);
    if (x < -60 || x > VIEW_W + 60) continue;
    drawBone(context, x, GROUND_Y - bone.y * SCALE, palette);
  }

  drawBuddy(context, state, palette);

  if (paused) {
    context.fillStyle = "rgba(0,0,0,0.55)";
    context.fillRect(0, 0, VIEW_W, VIEW_H);
    context.fillStyle = palette.text;
    context.font = "600 34px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("PAUSED", VIEW_W / 2, VIEW_H / 2);
    context.textAlign = "left";
  }
}

/** A skyline of candlesticks, parallaxed. Cosmetic, and the joke is free. */
function drawSkyline(context: CanvasRenderingContext2D, distance: number, palette: Record<string, string>) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const parallax = (distance * SCALE * 0.18) % 160;
  context.globalAlpha = 0.18;
  for (let index = -1; index < VIEW_W / 160 + 1; index++) {
    const x = index * 160 - parallax;
    const seedish = Math.abs(Math.sin(index * 12.9898 + Math.floor(distance / 100000)));
    const height = 40 + seedish * 90;
    const up = seedish > 0.5;
    context.fillStyle = up ? palette.rust : palette.muted;
    context.fillRect(x, GROUND_Y - height, 26, height);
    context.fillRect(x + 11, GROUND_Y - height - 18, 4, 18);
  }
  context.globalAlpha = 1;
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  obstacle: any,
  x: number,
  palette: Record<string, string>,
) {
  const { kind } = obstacle;
  const width = kind.width * SCALE;
  const low = GROUND_Y - kind.low * SCALE;
  const high = GROUND_Y - kind.high * SCALE;

  if (kind.key === "rug") {
    // A rolled-up rug.
    context.fillStyle = palette.rust;
    context.strokeStyle = palette.border;
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(x, high, width, low - high, 8);
    context.fill();
    context.stroke();
    context.strokeStyle = palette.panel2;
    for (let stripe = 1; stripe < 4; stripe++) {
      context.beginPath();
      context.moveTo(x + (width / 4) * stripe, high + 3);
      context.lineTo(x + (width / 4) * stripe, low - 3);
      context.stroke();
    }
    return;
  }

  if (kind.key === "sign") {
    context.strokeStyle = palette.muted;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x + width / 2, low);
    context.lineTo(x + width / 2, high + 14);
    context.stroke();

    context.fillStyle = palette.bad;
    context.beginPath();
    context.roundRect(x - 6, high, width + 12, 24, 4);
    context.fill();

    context.fillStyle = "#17130a";
    context.font = "700 11px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("DEV SOLD", x + width / 2, high + 16);
    context.textAlign = "left";
    return;
  }

  // A broken chart shard, hanging low enough to duck.
  context.fillStyle = palette.bad;
  context.globalAlpha = 0.9;
  context.beginPath();
  context.moveTo(x, high);
  context.lineTo(x + width, high + 10);
  context.lineTo(x + width * 0.72, low);
  context.lineTo(x + width * 0.28, low - 8);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;

  context.strokeStyle = palette.panel;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x + 6, high + 16);
  context.lineTo(x + width * 0.5, low - 22);
  context.lineTo(x + width - 8, high + 30);
  context.stroke();
}

function drawBone(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  palette: Record<string, string>,
) {
  const size = RUNNER_WORLD.BONE_SIZE * SCALE;
  context.fillStyle = palette.accent;
  context.beginPath();
  context.arc(x + size * 0.25, y - size * 0.5, size * 0.28, 0, Math.PI * 2);
  context.arc(x + size * 0.75, y - size * 0.5, size * 0.28, 0, Math.PI * 2);
  context.fill();
  context.fillRect(x + size * 0.2, y - size * 0.66, size * 0.6, size * 0.32);
}

function drawBuddy(context: CanvasRenderingContext2D, state: any, palette: Record<string, string>) {
  const height = (state.sliding ? RUNNER_WORLD.SLIDE_HEIGHT : RUNNER_WORLD.BUDDY_HEIGHT) * SCALE;
  const width = RUNNER_WORLD.BUDDY_WIDTH * SCALE;
  const y = GROUND_Y - state.y * SCALE - height;

  context.save();
  context.translate(BUDDY_SCREEN_X, y);

  // Body.
  context.fillStyle = palette.rust;
  context.strokeStyle = palette.border;
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(0, height * 0.18, width * 0.82, height * 0.62, height * 0.24);
  context.fill();
  context.stroke();

  // Head.
  context.beginPath();
  context.arc(width * 0.86, height * 0.3, height * 0.24, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // Snout.
  context.fillStyle = palette.text;
  context.beginPath();
  context.ellipse(width * 1.06, height * 0.34, height * 0.11, height * 0.08, 0, 0, Math.PI * 2);
  context.fill();

  // Ear, flapping with the run.
  context.fillStyle = palette.border;
  const flap = Math.sin(state.tick * 0.35) * height * 0.06;
  context.beginPath();
  context.ellipse(width * 0.76, height * 0.16 + flap, height * 0.09, height * 0.16, 0.4, 0, Math.PI * 2);
  context.fill();

  // Eye.
  context.fillStyle = "#17130a";
  context.beginPath();
  context.arc(width * 0.94, height * 0.24, height * 0.045, 0, Math.PI * 2);
  context.fill();

  // Collar.
  context.fillStyle = palette.accent;
  context.fillRect(width * 0.66, height * 0.24, height * 0.07, height * 0.26);

  // Legs: a two-phase cycle while grounded, tucked while airborne.
  context.strokeStyle = palette.rust;
  context.lineWidth = Math.max(3, height * 0.1);
  context.lineCap = "round";
  const legY = height * 0.78;
  const swing = state.grounded && !state.sliding ? Math.sin(state.tick * 0.55) * height * 0.16 : 0;
  const tuck = state.grounded ? 0 : -height * 0.12;

  context.beginPath();
  context.moveTo(width * 0.2, legY);
  context.lineTo(width * 0.2 + swing, height + tuck);
  context.moveTo(width * 0.62, legY);
  context.lineTo(width * 0.62 - swing, height + tuck);
  context.stroke();

  // Tail.
  context.lineWidth = Math.max(2.5, height * 0.08);
  context.beginPath();
  context.moveTo(0, height * 0.32);
  context.quadraticCurveTo(-width * 0.24, height * 0.14 + swing * 0.5, -width * 0.3, height * 0.34);
  context.stroke();

  context.restore();
}
