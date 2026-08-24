/**
 * The determinism net.
 *
 * These fixtures pin exact simulation outputs for known seeds and inputs. If a
 * change to the physics moves any of these numbers, the change is not
 * backwards compatible: rounds already issued to players would replay to a
 * different score than the one they saw. Bump SIM_VERSION and regenerate
 * deliberately, never edit a fixture to make a test pass.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRng } from "../rng.js";
import { simulateThrow, describeField } from "../fetch-sim.js";
import { createRun, simulateRun, RUNNER_ACTIONS, RUNNER_WORLD } from "../runner-sim.js";

const SEED_A = "1f2e3d4c5b6a798807162534435261708f9eadbccbdae9f80716253443526170";
const SEED_B = "00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210";

test("rng rejects anything that is not a 32-byte hex seed", () => {
  assert.throws(() => createRng("abc"));
  assert.throws(() => createRng("g".repeat(64)));
  assert.throws(() => createRng(null));
});

test("seeds built from repeating byte patterns still diverge", () => {
  // A plain XOR fold collapses all of these to the same state. They must not
  // produce the same stream.
  const patterns = ["a".repeat(64), "3f".repeat(32), "7c".repeat(32), "0".repeat(64)];
  const draws = patterns.map((seed) => createRng(seed, 0).nextU32());
  assert.equal(new Set(draws).size, patterns.length);
});

test("streams within one seed are independent", () => {
  const draws = [0, 1, 2, 3].map((stream) => createRng(SEED_A, stream).nextU32());
  assert.equal(new Set(draws).size, 4);
});

test("rng is reproducible", () => {
  const first = Array.from({ length: 5 }, () => createRng(SEED_A, 2).nextU32());
  const second = Array.from({ length: 5 }, () => createRng(SEED_A, 2).nextU32());
  assert.deepEqual(first, second);
});

test("fetch fields are pinned", () => {
  assert.deepEqual(describeField(SEED_A, 0), { buddyStartX: 3804, windPerTick: -1 });
  assert.deepEqual(describeField(SEED_B, 1), { buddyStartX: 6725, windPerTick: -3 });
});

test("fetch throws are pinned", () => {
  const fixtures = [
    { seed: SEED_A, throwIndex: 0, angleQ: 12000, powerQ: 52000, grade: "miss", points: 0 },
    { seed: SEED_A, throwIndex: 0, angleQ: 60000, powerQ: 9000, grade: "okay", points: 30 },
    { seed: SEED_A, throwIndex: 2, angleQ: 33000, powerQ: 33000, grade: "good", points: 60 },
    { seed: SEED_B, throwIndex: 1, angleQ: 33000, powerQ: 33000, grade: "good", points: 60 },
    { seed: SEED_B, throwIndex: 2, angleQ: 12000, powerQ: 52000, grade: "miss", points: 0 },
  ];
  for (const fixture of fixtures) {
    const result = simulateThrow(fixture.seed, fixture.throwIndex, {
      angleQ: fixture.angleQ,
      powerQ: fixture.powerQ,
    });
    assert.equal(result.grade, fixture.grade, JSON.stringify(fixture));
    assert.equal(result.points, fixture.points, JSON.stringify(fixture));
  }
});

test("fetch input is clamped, not trusted", () => {
  const wild = simulateThrow(SEED_A, 0, { angleQ: 9e9, powerQ: -500 });
  const clamped = simulateThrow(SEED_A, 0, { angleQ: 65535, powerQ: 0 });
  assert.deepEqual(wild, clamped);
});

test("golden mode raises the ceiling by half and stays integral", () => {
  const input = { angleQ: 33000, powerQ: 33000 };
  const normal = simulateThrow(SEED_A, 2, input);
  const golden = simulateThrow(SEED_A, 2, input, { mode: "golden" });
  assert.equal(normal.points, 60);
  assert.equal(golden.points, 90);
  assert.equal(Number.isInteger(golden.points), true);
});

test("perfect combos pay a bonus, other grades never do", () => {
  // Search the input space for a perfect on this field.
  let perfect = null;
  for (let angleQ = 0; angleQ <= 65535 && !perfect; angleQ += 256) {
    for (let powerQ = 0; powerQ <= 65535; powerQ += 256) {
      const candidate = simulateThrow(SEED_A, 0, { angleQ, powerQ });
      if (candidate.grade === "perfect") {
        perfect = { angleQ, powerQ };
        break;
      }
    }
  }
  assert.ok(perfect, "expected at least one perfect throw to exist on this field");

  const first = simulateThrow(SEED_A, 0, perfect, { perfectStreak: 0 });
  const second = simulateThrow(SEED_A, 0, perfect, { perfectStreak: 1 });
  const third = simulateThrow(SEED_A, 0, perfect, { perfectStreak: 2 });
  assert.equal(first.points, 100);
  assert.equal(second.points, 125);
  assert.equal(third.points, 150);

  const okay = simulateThrow(SEED_A, 0, { angleQ: 60000, powerQ: 9000 }, { perfectStreak: 2 });
  assert.equal(okay.grade, "okay");
  assert.equal(okay.comboBonus, 0);
});

test("every grade is reachable on a real field", () => {
  const seen = new Set();
  for (let angleQ = 0; angleQ <= 65535; angleQ += 512) {
    for (let powerQ = 0; powerQ <= 65535; powerQ += 512) {
      seen.add(simulateThrow(SEED_A, 0, { angleQ, powerQ }).grade);
    }
  }
  assert.deepEqual([...seen].sort(), ["good", "miss", "okay", "perfect"]);
});

test("a run with no input dies on the first obstacle, with time to react", () => {
  const run = createRun(SEED_A);
  while (run.alive) run.step();
  const state = run.state;
  assert.equal(state.deathTick, 118);
  // Roughly two seconds of clear ground before anything can kill you.
  assert.ok(state.deathTick > 100, "first obstacle must not be an instant death");
});

test("runner replay reproduces live play exactly", () => {
  // Drive the stepper the way the browser does, recording as we go, then score
  // the recording the way the server does. The two must agree.
  for (const seed of [SEED_A, SEED_B, "a".repeat(64)]) {
    const run = createRun(seed);
    const inputs = [];
    while (run.alive) {
      const state = run.state;
      const nose = state.distance + RUNNER_WORLD.BUDDY_WIDTH;
      const next = state.obstacles.find((o) => o.x + o.kind.width >= nose);
      if (next && state.grounded) {
        const ticksAway = Math.floor((next.x - nose) / state.speed);
        if (next.kind.clear === "jump" && ticksAway >= 0 && ticksAway <= 7) {
          run.press(RUNNER_ACTIONS.JUMP);
          inputs.push({ tick: run.tick, action: RUNNER_ACTIONS.JUMP });
        } else if (next.kind.clear === "slide" && ticksAway >= 0 && ticksAway <= 3) {
          run.press(RUNNER_ACTIONS.SLIDE);
          inputs.push({ tick: run.tick, action: RUNNER_ACTIONS.SLIDE });
        }
      }
      run.step();
    }

    const replay = simulateRun(seed, inputs);
    assert.equal(replay.score, run.score(), `score mismatch for ${seed.slice(0, 8)}`);
    assert.equal(replay.distance, run.state.distance);
    assert.equal(replay.bones, run.state.bones);
  }
});

test("runner replay is pinned", () => {
  const trace = [
    { tick: 100, action: RUNNER_ACTIONS.JUMP },
    { tick: 160, action: RUNNER_ACTIONS.SLIDE },
    { tick: 220, action: RUNNER_ACTIONS.JUMP },
  ];
  assert.deepEqual(simulateRun(SEED_A, trace), {
    score: 71,
    distance: 7140,
    bones: 0,
    deathTick: 118,
    endedBy: "collision",
  });
});

test("malformed input traces are rejected rather than scored", () => {
  assert.throws(() => simulateRun(SEED_A, "not an array"));
  assert.throws(() => simulateRun(SEED_A, [{ tick: 5, action: 9 }]), /unknown action/);
  assert.throws(
    () => simulateRun(SEED_A, [{ tick: 5, action: 0 }, { tick: 5, action: 0 }]),
    /increasing/,
  );
  assert.throws(
    () => simulateRun(SEED_A, [{ tick: 9, action: 0 }, { tick: 3, action: 0 }]),
    /increasing/,
  );
  assert.throws(() => simulateRun(SEED_A, [{ tick: -1, action: 0 }]), /out of range/);
  const tooMany = Array.from({ length: 3001 }, (_, i) => ({ tick: i, action: 0 }));
  assert.throws(() => simulateRun(SEED_A, tooMany), /too many/);
});

test("a jump cannot be started in mid-air", () => {
  const run = createRun(SEED_A);
  run.press(RUNNER_ACTIONS.JUMP);
  run.step();
  const airborne = run.state.y;
  assert.ok(airborne > 0);
  // Spamming jump must not levitate Buddy.
  for (let i = 0; i < 5; i++) {
    run.press(RUNNER_ACTIONS.JUMP);
    run.step();
  }
  const apexReached = run.state.y;
  const ceiling = (RUNNER_WORLD.JUMP_VELOCITY * RUNNER_WORLD.JUMP_VELOCITY) / (2 * RUNNER_WORLD.GRAVITY);
  assert.ok(apexReached <= ceiling + RUNNER_WORLD.JUMP_VELOCITY, "jump height must stay bounded");
});
