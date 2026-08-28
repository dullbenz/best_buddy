/**
 * New Tricks — the deterministic half of creator-made games.
 *
 * A trick is authored content (a quiz, a word scramble, an emoji riddle), so
 * there is no physics here: the shared machinery is scoring and the scramble
 * permutation, and both must be bit-identical on the client that previews a
 * score and the server that awards one.
 *
 * Everything is integer arithmetic. Ticks are claimed per-item answer times in
 * milliseconds; the server separately checks that their raw total accounts for
 * the wall-clock time it observed, so the speed bonus cannot be claimed from
 * an idle tab. That check reads a clock and therefore lives in the functions,
 * not here.
 */
import { createRng } from "./rng.js";

/**
 * Versioned separately from SIM_VERSION on purpose: tuning trick scoring must
 * not invalidate in-flight fetch or runner rounds, and retuning the physics
 * must not reject every open trick attempt. Same doctrine, scoped blast
 * radius — stamped on start, checked on submit, bumped deliberately.
 */
export const TRICKS_SIM_VERSION = 1;

/**
 * One source of truth for what a trick may contain and how it is timed. The
 * authoring form, the server-side validator, and the players all read these —
 * a bound that exists in two places will eventually disagree in one of them.
 */
export const TRICKS_LIMITS = {
  templates: ["quiz", "scramble", "riddle"],
  titleMax: 60,
  introMax: 280,
  quiz: { minItems: 5, maxItems: 15, minOptions: 2, maxOptions: 4, promptMax: 200, optionMax: 80 },
  scramble: { minItems: 5, maxItems: 15, wordMin: 3, wordMax: 16, hintMax: 120 },
  riddle: { minItems: 5, maxItems: 12, emojiMaxCodePoints: 32, answerMax: 60, hintMax: 120 },
  /** Per-item answer window; a slower answer still counts, with no bonus. */
  itemTimeLimitMs: 30000,
  /** Base points for a correct item, and the ceiling of its speed bonus. */
  pointsPerCorrect: 100,
  speedBonusMax: 50,
  /**
   * Slack the server allows between the summed raw ticks and the wall clock it
   * measured between start and submit — page loads, network, a breath before
   * the first question. Generous on purpose: the grace is the whole cheat
   * surface, and 15 seconds of shaved bonus decides nothing a human review of
   * the prize snapshot would miss.
   */
  elapsedGraceMs: 15000,
};

/**
 * The scrambled letters for one word, derived from the round seed.
 *
 * The server derives these from the private answer at start time and hands the
 * letters to the client — the word itself never travels. Client and server use
 * the same seed and item index, so a score previewed against these letters is
 * the score the server computes.
 */
export function scrambleWord(seedHex, itemIndex, word) {
  if (typeof word !== "string" || word.length === 0) {
    throw new Error("scrambleWord needs a non-empty word");
  }
  const rng = createRng(seedHex, itemIndex);
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const swap = letters[i];
    letters[i] = letters[j];
    letters[j] = swap;
  }
  let scrambled = letters.join("");
  if (scrambled === word && word.length > 1) {
    // A shuffle is allowed to reproduce its input; a scramble that shows the
    // answer is not. Rotation is deterministic, so both sides agree on it.
    // (A degenerate word like "aaa" cannot be hidden by any permutation and
    // comes back unchanged — that is the author's problem, not a leak.)
    scrambled = word.slice(1) + word[0];
  }
  return scrambled;
}

/**
 * Validate a claimed tick array and clamp each entry into the scoring window.
 *
 * Malformed shapes throw — the server turns that into a 400 rather than
 * guessing. Values are only clamped, never trusted: a negative tick is a lie,
 * an oversized one is just a slow answer.
 */
export function clampTicks(ticks, itemCount, limits = TRICKS_LIMITS) {
  if (!Array.isArray(ticks) || ticks.length !== itemCount) {
    throw new Error(`ticks must be an array of ${itemCount} entries`);
  }
  return ticks.map((tick) => {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error("each tick must be a non-negative integer");
    }
    return Math.min(tick, limits.itemTimeLimitMs);
  });
}

/**
 * Score one completed attempt: base points per correct item plus a speed bonus
 * that decays linearly across the answer window. `ticks` must already be
 * clamped; `correct` is the server's own grading, never the client's.
 */
export function scoreTrick({ correct, ticks, limits = TRICKS_LIMITS }) {
  if (!Array.isArray(correct) || correct.length !== ticks.length) {
    throw new Error("correct and ticks must describe the same items");
  }
  let total = 0;
  const perItem = correct.map((isCorrect, index) => {
    if (!isCorrect) return 0;
    const remaining = limits.itemTimeLimitMs - ticks[index];
    const bonus = Math.floor((limits.speedBonusMax * remaining) / limits.itemTimeLimitMs);
    const points = limits.pointsPerCorrect + bonus;
    total += points;
    return points;
  });
  return { total, perItem };
}
