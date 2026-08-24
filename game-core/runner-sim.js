/**
 * Buddy vs. The Rugs — the endless-runner simulation.
 *
 * Buddy runs right at a speed that ramps with distance. Rolled rugs and "DEV
 * SOLD" signs sit on the ground and have to be jumped; broken-chart shards hang
 * low and have to be slid under. Bones are worth collecting. One collision ends
 * the run.
 *
 * `createRun` is the stepper the browser drives one tick at a time as the
 * player presses keys; `simulateRun` drives that same stepper over a recorded
 * input trace, which is what the server does to score a submission. There is
 * deliberately only one implementation of the physics, so a run cannot be
 * scored under rules different from the ones it was played under.
 *
 * Integers only, no clock, no imports beyond the RNG. Ground is y = 0, a tick
 * is 1/60 s, and one distance unit is 1/256 of a "field metre".
 */
import { createRng } from "./rng.js";

export const RUNNER_ACTIONS = { JUMP: 0, SLIDE: 1 };

export const RUNNER_LIMITS = {
  /** Inputs a submission may contain before it is rejected unread. */
  maxInputs: 3000,
  /** Ticks the server will replay: ~11 minutes of running. */
  maxTicks: 40000,
};

const START_SPEED = 60;
const MAX_SPEED = 160;
/** Speed gains one unit every this many ticks. */
const SPEED_RAMP_TICKS = 240;

const JUMP_VELOCITY = 60;
const GRAVITY = 6;
const SLIDE_TICKS = 26;

const BUDDY_WIDTH = 90;
const BUDDY_HEIGHT = 120;
const SLIDE_HEIGHT = 55;

/** Vertical band each obstacle kind occupies, and how it has to be handled. */
const OBSTACLE_KINDS = [
  { key: "rug", low: 0, high: 70, width: 120, clear: "jump" },
  { key: "sign", low: 0, high: 130, width: 90, clear: "jump" },
  { key: "shard", low: 100, high: 420, width: 110, clear: "slide" },
];

const BONE_SIZE = 46;
const POINTS_PER_BONE = 25;
/** Distance travelled per point of score. */
const DISTANCE_PER_POINT = 100;

/** ~2 seconds of clear ground before the first obstacle, so the run starts with
 *  a beat to read the screen rather than an instant death. */
const FIRST_SPAWN_X = 7200;
const SPAWN_LOOKAHEAD = 4000;

export const RUNNER_WORLD = {
  START_SPEED,
  MAX_SPEED,
  SPEED_RAMP_TICKS,
  JUMP_VELOCITY,
  GRAVITY,
  SLIDE_TICKS,
  BUDDY_WIDTH,
  BUDDY_HEIGHT,
  SLIDE_HEIGHT,
  OBSTACLE_KINDS,
  BONE_SIZE,
  POINTS_PER_BONE,
  DISTANCE_PER_POINT,
  FIRST_SPAWN_X,
  SPAWN_LOOKAHEAD,
};

function speedAtTick(tick) {
  const speed = START_SPEED + Math.trunc(tick / SPEED_RAMP_TICKS);
  return speed > MAX_SPEED ? MAX_SPEED : speed;
}

function overlaps(aLow, aHigh, bLow, bHigh) {
  return aLow < bHigh && bLow < aHigh;
}

/**
 * A live run. Call `press` for each action the player takes, then `step` once
 * per tick; read `state` to draw the frame.
 *
 * @param {string} seed 64 hex chars, issued by the server
 */
export function createRun(seed) {
  const rng = createRng(seed, 1);

  let tick = 0;
  let distance = 0;
  let y = 0;
  let vy = 0;
  let grounded = true;
  let slideTicksLeft = 0;
  let bones = 0;
  let alive = true;
  let deathTick = null;
  let deathKind = null;

  /** Pending actions for the tick about to be stepped. */
  let pending = [];

  const obstacles = [];
  const boneItems = [];
  let nextSpawnX = FIRST_SPAWN_X;

  function spawnAhead() {
    while (nextSpawnX < distance + SPAWN_LOOKAHEAD) {
      const kind = OBSTACLE_KINDS[rng.nextInt(OBSTACLE_KINDS.length)];
      obstacles.push({ x: nextSpawnX, kind });

      // A bone sits in the gap after each obstacle, sometimes high enough that
      // taking it means jumping something you could have run under.
      if (rng.nextInt(100) < 65) {
        const high = rng.nextInt(100) < 40;
        boneItems.push({
          x: nextSpawnX + rng.nextRange(700, 1400),
          y: high ? rng.nextRange(150, 260) : 20,
        });
      }

      // Gaps are measured in ticks of reaction time rather than raw distance,
      // so the speed ramp squeezes the timing window instead of making the
      // game outright impossible.
      const slack = Math.min(18, Math.trunc(distance / 26000));
      const gapTicks = rng.nextRange(46, 104) - slack;
      nextSpawnX += speedAtTick(tick) * gapTicks;
    }
  }

  spawnAhead();

  function press(action) {
    if (!alive) return;
    const value = action | 0;
    if (value !== RUNNER_ACTIONS.JUMP && value !== RUNNER_ACTIONS.SLIDE) return;
    pending.push(value);
  }

  /** Advance one tick. Returns false once the run is over. */
  function step() {
    if (!alive) return false;

    for (const action of pending) {
      if (action === RUNNER_ACTIONS.JUMP) {
        if (grounded) {
          vy = JUMP_VELOCITY;
          grounded = false;
          slideTicksLeft = 0;
        }
      } else if (grounded) {
        slideTicksLeft = SLIDE_TICKS;
      }
    }
    pending = [];

    distance += speedAtTick(tick);
    if (!grounded) {
      y += vy;
      vy -= GRAVITY;
      if (y <= 0) {
        y = 0;
        vy = 0;
        grounded = true;
      }
    }
    if (slideTicksLeft > 0) slideTicksLeft--;

    spawnAhead();

    const height = slideTicksLeft > 0 ? SLIDE_HEIGHT : BUDDY_HEIGHT;
    const buddyLeft = distance;
    const buddyRight = distance + BUDDY_WIDTH;
    const buddyHigh = y + height;

    while (obstacles.length > 0 && obstacles[0].x + obstacles[0].kind.width < buddyLeft) {
      obstacles.shift();
    }
    for (const obstacle of obstacles) {
      if (obstacle.x > buddyRight) break;
      const { kind } = obstacle;
      if (
        overlaps(buddyLeft, buddyRight, obstacle.x, obstacle.x + kind.width) &&
        overlaps(y, buddyHigh, kind.low, kind.high)
      ) {
        alive = false;
        deathTick = tick;
        deathKind = kind.key;
        break;
      }
    }

    if (alive) {
      // Bones are not necessarily in x order — one can be dropped in a gap a
      // later spawn overtakes — so they are scanned rather than pruned by head.
      for (let i = 0; i < boneItems.length; i++) {
        const bone = boneItems[i];
        if (bone.x + BONE_SIZE < buddyLeft) {
          boneItems.splice(i, 1);
          i--;
          continue;
        }
        if (
          overlaps(buddyLeft, buddyRight, bone.x, bone.x + BONE_SIZE) &&
          overlaps(y, buddyHigh, bone.y, bone.y + BONE_SIZE)
        ) {
          bones++;
          boneItems.splice(i, 1);
          i--;
        }
      }
    }

    tick++;
    if (tick > RUNNER_LIMITS.maxTicks) alive = false;
    return alive;
  }

  function score() {
    return Math.trunc(distance / DISTANCE_PER_POINT) + bones * POINTS_PER_BONE;
  }

  return {
    press,
    step,
    score,
    get tick() {
      return tick;
    },
    get alive() {
      return alive;
    },
    /** Everything a renderer needs for the current frame. */
    get state() {
      return {
        tick,
        distance,
        y,
        vy,
        grounded,
        sliding: slideTicksLeft > 0,
        slideTicksLeft,
        bones,
        alive,
        deathTick,
        deathKind,
        speed: speedAtTick(tick),
        score: score(),
        obstacles,
        boneItems,
      };
    },
  };
}

/**
 * Replay a recorded run. This is the server's scoring path.
 *
 * @param {string} seed 64 hex chars
 * @param {Array<{tick: number, action: number}>} inputs sorted, within RUNNER_LIMITS
 */
export function simulateRun(seed, inputs) {
  if (!Array.isArray(inputs)) throw new Error("inputs must be an array");
  if (inputs.length > RUNNER_LIMITS.maxInputs) throw new Error("too many inputs");

  // A malformed trace is a rejected submission, not a crash.
  let previousTick = -1;
  for (const input of inputs) {
    const tick = input.tick | 0;
    const action = input.action | 0;
    if (tick < 0 || tick > RUNNER_LIMITS.maxTicks) throw new Error("input tick out of range");
    if (tick <= previousTick) throw new Error("inputs must be strictly increasing in tick");
    if (action !== RUNNER_ACTIONS.JUMP && action !== RUNNER_ACTIONS.SLIDE) {
      throw new Error("unknown action");
    }
    previousTick = tick;
  }

  const run = createRun(seed);
  let cursor = 0;

  while (run.alive) {
    while (cursor < inputs.length && (inputs[cursor].tick | 0) === run.tick) {
      run.press(inputs[cursor].action | 0);
      cursor++;
    }
    run.step();
  }

  const state = run.state;
  return {
    score: run.score(),
    distance: state.distance,
    bones: state.bones,
    deathTick: state.deathTick,
    endedBy: state.deathTick === null ? "tickLimit" : "collision",
  };
}
