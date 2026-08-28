/**
 * The determinism net for trick scoring and scrambles.
 *
 * Same doctrine as sims.test.js: these fixtures pin exact outputs for known
 * seeds. If a change moves any of them, attempts already issued would replay
 * to a different score than the player watched. Bump TRICKS_SIM_VERSION and
 * regenerate deliberately, never edit a fixture to make a test pass.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { scrambleWord, clampTicks, scoreTrick, TRICKS_LIMITS } from "../tricks-sim.js";

const SEED_A = "1f2e3d4c5b6a798807162534435261708f9eadbccbdae9f80716253443526170";
const SEED_B = "00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210";

test("scrambles are pinned", () => {
  const fixtures = [
    { seed: SEED_A, index: 0, word: "buddy", scrambled: "ddybu" },
    { seed: SEED_A, index: 0, word: "moonbone", scrambled: "moonobne" },
    { seed: SEED_A, index: 1, word: "buddy", scrambled: "uyddb" },
    { seed: SEED_A, index: 2, word: "fetch", scrambled: "cfeth" },
    { seed: SEED_B, index: 0, word: "buddy", scrambled: "dbduy" },
    { seed: SEED_B, index: 1, word: "moonbone", scrambled: "omooennb" },
    { seed: SEED_B, index: 2, word: "fetch", scrambled: "techf" },
  ];
  for (const fixture of fixtures) {
    assert.equal(
      scrambleWord(fixture.seed, fixture.index, fixture.word),
      fixture.scrambled,
      JSON.stringify(fixture),
    );
  }
});

test("a scramble never shows the answer", () => {
  // Sweep seeds and stream lanes; the only permitted identity is a word no
  // permutation can hide.
  const words = ["cat", "bone", "buddy", "treats", "moonbone"];
  for (let byte = 0; byte < 32; byte += 1) {
    const seed = byte.toString(16).padStart(2, "0").repeat(32);
    for (let index = 0; index < 8; index += 1) {
      for (const word of words) {
        assert.notEqual(scrambleWord(seed, index, word), word, `${seed} ${index} ${word}`);
      }
    }
  }
  assert.equal(scrambleWord(SEED_A, 0, "aaa"), "aaa");
});

test("scrambles are reproducible and keep every letter", () => {
  const first = scrambleWord(SEED_A, 3, "moonbone");
  const second = scrambleWord(SEED_A, 3, "moonbone");
  assert.equal(first, second);
  assert.equal([...first].sort().join(""), [..."moonbone"].sort().join(""));
});

test("scores are pinned", () => {
  const result = scoreTrick({
    correct: [true, true, false, true, true],
    ticks: clampTicks([0, 15000, 3000, 29999, 999999], 5),
  });
  assert.deepEqual(result, { total: 475, perItem: [150, 125, 0, 100, 100] });
});

test("ticks are clamped, not trusted", () => {
  assert.deepEqual(clampTicks([0, 999999999], 2), [0, TRICKS_LIMITS.itemTimeLimitMs]);
});

test("malformed ticks throw instead of scoring", () => {
  assert.throws(() => clampTicks("fast", 1));
  assert.throws(() => clampTicks([100], 2), /array of 2/);
  assert.throws(() => clampTicks([-1], 1), /non-negative/);
  assert.throws(() => clampTicks([1.5], 1), /integer/);
  assert.throws(() => clampTicks([null], 1));
  assert.throws(() => scoreTrick({ correct: [true], ticks: [0, 0] }));
  assert.throws(() => scrambleWord(SEED_A, 0, ""));
  assert.throws(() => scrambleWord("abc", 0, "word"));
});

test("the whole tick window maps to the documented bonus range", () => {
  // Every correct answer is worth base..base+max, monotonically non-increasing
  // in time — a faster answer can never score less.
  const { itemTimeLimitMs, pointsPerCorrect, speedBonusMax } = TRICKS_LIMITS;
  let previous = Infinity;
  for (let tick = 0; tick <= itemTimeLimitMs; tick += 500) {
    const { total } = scoreTrick({ correct: [true], ticks: [tick] });
    assert.ok(total >= pointsPerCorrect && total <= pointsPerCorrect + speedBonusMax);
    assert.ok(total <= previous, `score rose with time at tick ${tick}`);
    previous = total;
  }
  assert.equal(scoreTrick({ correct: [true], ticks: [0] }).total, pointsPerCorrect + speedBonusMax);
  assert.equal(
    scoreTrick({ correct: [true], ticks: [itemTimeLimitMs] }).total,
    pointsPerCorrect,
  );
});
