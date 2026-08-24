/**
 * Buddy's Daily Fetch — the throw simulation.
 *
 * The player splits a fixed power budget between horizontal and vertical
 * velocity (drag back and up: flatter throws go further, steeper throws hang
 * longer). Buddy sprints for wherever the ball will land. He catches it if he
 * can cover the distance in the time the ball is in the air, and the catch is
 * graded on how little time he had to spare: arriving with a whole second in
 * hand is a jog, arriving on the last tick is a diving catch.
 *
 * That makes each throw a search for a band, not a ceiling — both a weak throw
 * and an overcooked one land out of reach — and the band moves every throw
 * because the wind and Buddy's starting position come from the round seed.
 *
 * There is no trigonometry and no floating point anywhere in here: the whole
 * simulation is integer arithmetic so the browser and the Cloud Function that
 * re-scores the throw cannot disagree.
 *
 * Distances are in units of 1/256 of a "field metre"; velocities are units per
 * tick; a tick is 1/60 s.
 */
import { createRng } from "./rng.js";

/** Power budget, split between vx and vy. */
const MIN_SPEED = 620;
const MAX_SPEED = 1500;

/** Share of the budget spent on lift, in 1024ths. Clamped away from the
 *  degenerate ends so every throw is a real arc. */
const MIN_LIFT = 220;
const MAX_LIFT = 820;

const GRAVITY = 40;
/** Tuned so that sweeping the whole input space grades roughly 8% perfect,
 *  19% good, 44% okay, 30% miss: a flail mostly lands out of reach, and the
 *  band is wide enough to find but tight enough that a perfect is aimed. */
const BUDDY_SPEED = 340;

/** How close to out-of-reach the catch was, in distance units. */
const PERFECT_MARGIN = 1200;
const GOOD_MARGIN = 3500;

export const FETCH_GRADES = {
  perfect: { key: "perfect", base: 100, label: "PERFECT" },
  good: { key: "good", base: 60, label: "GOOD" },
  okay: { key: "okay", base: 30, label: "OKAY" },
  miss: { key: "miss", base: 0, label: "MISS" },
};

/** Consecutive perfects inside one round, indexed by how many came before. */
const COMBO_BONUS = [0, 25, 50];

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * The conditions for one throw. Deterministic from (seed, throwIndex), so the
 * client can draw the same field the server will score against.
 *
 * @param {string} seed 64 hex chars, issued by the server
 * @param {number} throwIndex 0-based
 */
export function describeField(seed, throwIndex) {
  const rng = createRng(seed, throwIndex + 1);
  return {
    // Where Buddy is waiting when the ball leaves your hand.
    buddyStartX: rng.nextRange(3000, 9000),
    // Positive blows the ball downfield, negative holds it up.
    windPerTick: rng.nextRange(-40, 40),
  };
}

/**
 * Score one throw.
 *
 * @param {string} seed        round seed
 * @param {number} throwIndex  0-based index within the round
 * @param {{angleQ: number, powerQ: number}} input  both 0..65535
 * @param {{mode?: "normal"|"golden", perfectStreak?: number}} [options]
 *        `perfectStreak` is how many perfects immediately preceded this throw
 *        in the same round; `golden` is the stake-gated higher-ceiling ball.
 */
export function simulateThrow(seed, throwIndex, input, options = {}) {
  const mode = options.mode === "golden" ? "golden" : "normal";
  const perfectStreak = clamp(options.perfectStreak | 0, 0, COMBO_BONUS.length - 1);

  const angleQ = clamp(input.angleQ | 0, 0, 65535);
  const powerQ = clamp(input.powerQ | 0, 0, 65535);

  const { buddyStartX, windPerTick } = describeField(seed, throwIndex);

  const speed = MIN_SPEED + Math.trunc((powerQ * (MAX_SPEED - MIN_SPEED)) / 65535);
  const lift = MIN_LIFT + Math.trunc((angleQ * (MAX_LIFT - MIN_LIFT)) / 65535);

  const vy = Math.trunc((speed * lift) / 1024);
  const vx = Math.trunc((speed * (1024 - lift)) / 1024);

  // Up and back down again.
  const flightTicks = Math.trunc((2 * vy) / GRAVITY);
  const landingX = vx * flightTicks + windPerTick * flightTicks;

  const runDistance = Math.abs(landingX - buddyStartX);
  const reach = BUDDY_SPEED * flightTicks;
  const margin = reach - runDistance;

  let grade;
  if (margin < 0) grade = FETCH_GRADES.miss;
  else if (margin <= PERFECT_MARGIN) grade = FETCH_GRADES.perfect;
  else if (margin <= GOOD_MARGIN) grade = FETCH_GRADES.good;
  else grade = FETCH_GRADES.okay;

  let points = grade.base;
  let comboBonus = 0;
  if (grade.key === "perfect") {
    comboBonus = COMBO_BONUS[perfectStreak];
    points += comboBonus;
  }
  // Golden Bone raises the ceiling by half. Every base is a multiple of 2 so
  // this stays exact in integers.
  if (mode === "golden") points = Math.trunc((points * 3) / 2);

  return {
    grade: grade.key,
    label: grade.label,
    base: grade.base,
    comboBonus,
    points,
    mode,
    // Everything the client needs to animate exactly what was scored.
    field: { buddyStartX, windPerTick },
    flight: { vx, vy, flightTicks, landingX, gravity: GRAVITY },
    buddy: { runDistance, reach, margin, speed: BUDDY_SPEED },
  };
}
