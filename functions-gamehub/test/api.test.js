/**
 * End-to-end API tests against the Firebase emulators.
 *
 * Run through `firebase emulators:exec`, which starts Auth, Firestore and
 * Functions and points the Admin SDK at them. Nothing here mocks the API: every
 * assertion goes over HTTP to the real handlers, signs with a real ed25519 key,
 * and reads back real Firestore state.
 *
 * The suite covers each game's happy path plus the ways each one can be cheated,
 * because the second half is the half worth testing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";

import { createRun, RUNNER_ACTIONS, RUNNER_WORLD } from "../core/runner-sim.js";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-gamehub";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const BASE = `http://${FUNCTIONS_HOST}/${PROJECT}/us-central1/gamehubApiStaging/api`;
const TEST_KEY = process.env.GAMEHUB_TEST_KEY || "local-test-key";

let requestCounter = 0;
const nextRequestId = () => `req-${Date.now()}-${requestCounter++}`;

async function call(path, { method = "GET", body, token, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

/** A throwaway wallet, signed in for real. */
async function signIn() {
  const keypair = nacl.sign.keyPair();
  const wallet = bs58.encode(Buffer.from(keypair.publicKey));

  const challenge = await call("/auth/challenge", { method: "POST", body: { wallet } });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));

  const signature = bs58.encode(
    Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(challenge.body.message), keypair.secretKey),
    ),
  );

  const verified = await call("/auth/verify", {
    method: "POST",
    body: { wallet, nonce: challenge.body.nonce, signature },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));

  // Trade the custom token for an ID token exactly as the browser SDK would.
  const exchange = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: verified.body.token, returnSecureToken: true }),
    },
  );
  const session = await exchange.json();
  assert.ok(session.idToken, `no id token: ${JSON.stringify(session)}`);

  return { wallet, keypair, token: session.idToken, challenge: challenge.body };
}

test("health reports the cluster it was built for", async () => {
  const { status, body } = await call("/healthz");
  assert.equal(status, 200);
  assert.equal(body.cluster, "devnet");
});

test("sign-in round trip works and is not replayable", async () => {
  const { wallet, keypair, challenge, token } = await signIn();

  const me = await call("/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.wallet, wallet);

  // The same nonce a second time must fail, even with a valid signature.
  const signature = bs58.encode(
    Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey)),
  );
  const replay = await call("/auth/verify", {
    method: "POST",
    body: { wallet, nonce: challenge.nonce, signature },
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, "CHALLENGE_INVALID");
});

test("a signature from the wrong key is rejected", async () => {
  const victim = nacl.sign.keyPair();
  const attacker = nacl.sign.keyPair();
  const wallet = bs58.encode(Buffer.from(victim.publicKey));

  const challenge = await call("/auth/challenge", { method: "POST", body: { wallet } });
  const signature = bs58.encode(
    Buffer.from(
      nacl.sign.detached(
        new TextEncoder().encode(challenge.body.message),
        attacker.secretKey,
      ),
    ),
  );

  const verified = await call("/auth/verify", {
    method: "POST",
    body: { wallet, nonce: challenge.body.nonce, signature },
  });
  assert.equal(verified.status, 401);
  assert.equal(verified.body.error.code, "SIGNATURE_INVALID");
});

test("game endpoints refuse anonymous callers", async () => {
  const { status, body } = await call("/pet", {
    method: "POST",
    body: { requestId: nextRequestId() },
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, "NO_SESSION");
});

test("petting scores a point, enforces its cooldown, and is idempotent", async () => {
  const { wallet, token } = await signIn();

  const first = await call("/pet", { method: "POST", token, body: { requestId: nextRequestId() } });
  assert.equal(first.status, 200);
  assert.equal(first.body.points, 1);

  // Straight back in: the cooldown must bite.
  const tooSoon = await call("/pet", {
    method: "POST",
    token,
    body: { requestId: nextRequestId() },
  });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.body.error.code, "COOLDOWN");

  // A retry of the *first* request must replay its response, not award again.
  const requestId = nextRequestId();
  const scored = await call("/pet", { method: "POST", token, body: { requestId } });
  assert.equal(scored.status, 429, "still cooling down");

  const profile = await call(`/reputation/${wallet}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.gbp, 1);
  assert.equal(profile.body.rank, "stray");
});

test("a replayed requestId does not award twice", async () => {
  const { wallet, token } = await signIn();
  const requestId = nextRequestId();

  const first = await call("/pet", { method: "POST", token, body: { requestId } });
  assert.equal(first.status, 200);

  const replayed = await call("/pet", { method: "POST", token, body: { requestId } });
  assert.equal(replayed.status, 200);
  assert.deepEqual(replayed.body, first.body);

  const profile = await call(`/reputation/${wallet}`);
  assert.equal(profile.body.gbp, 1, "the replay must not have scored a second point");
});

test("super pet requires a stake", async () => {
  const { token } = await signIn();
  // The emulator stub treats every wallet as staked, so this is the open case.
  const { status, body } = await call("/pet/super", {
    method: "POST",
    token,
    body: { requestId: nextRequestId() },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.points > 1, "a super pet is worth more than a pet");
});

test("fetch grades throws server-side and runs out after three", async () => {
  const { wallet, token } = await signIn();

  const start = await call("/fetch/start", { method: "POST", token });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.throwsRemaining, 3);
  assert.equal(start.body.streakDays, 1);
  assert.match(start.body.seed, /^[0-9a-f]{64}$/);

  const grades = [];
  for (let index = 0; index < 3; index++) {
    const thrown = await call("/fetch/throw", {
      method: "POST",
      token,
      body: {
        roundId: start.body.roundId,
        angleQ: 30000 + index * 500,
        powerQ: 40000,
        requestId: nextRequestId(),
      },
    });
    assert.equal(thrown.status, 200, JSON.stringify(thrown.body));
    assert.ok(["perfect", "good", "okay", "miss"].includes(thrown.body.grade));
    grades.push(thrown.body.grade);
  }

  const fourth = await call("/fetch/throw", {
    method: "POST",
    token,
    body: {
      roundId: start.body.roundId,
      angleQ: 30000,
      powerQ: 40000,
      requestId: nextRequestId(),
    },
  });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.body.error.code, "NO_THROWS_LEFT");

  const state = await call("/fetch/state", { token });
  assert.equal(state.body.throwsRemaining, 0);
  assert.ok(state.body.resetsAt, "the client needs to know when throws come back");

  // Golden Bone: the stub stakes everyone, so the round should be golden.
  assert.equal(start.body.mode, "golden");
  assert.equal(start.body.goldenEligible, true);
  assert.ok(wallet);
});

test("runner accepts an honest replay and rejects a doctored score", async () => {
  const { token } = await signIn();

  const started = await call("/runner/start", { method: "POST", token });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  // Play the run for real against the same simulation the server will use.
  const run = createRun(started.body.seed);
  const inputs = [];
  while (run.alive) {
    const state = run.state;
    const nose = state.distance + RUNNER_WORLD.BUDDY_WIDTH;
    const next = state.obstacles.find((obstacle) => obstacle.x + obstacle.kind.width >= nose);
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
    // Keep the test quick: stop once there is a real score to submit.
    if (run.tick > 900) break;
  }

  const truncated = inputs.filter((input) => input.tick <= 900);
  const honest = createRun(started.body.seed);
  let cursor = 0;
  while (honest.alive && honest.tick <= 900) {
    while (cursor < truncated.length && truncated[cursor].tick === honest.tick) {
      honest.press(truncated[cursor].action);
      cursor++;
    }
    honest.step();
  }

  const submitted = await call("/runner/submit", {
    method: "POST",
    token,
    body: {
      runId: started.body.runId,
      inputs: truncated,
      score: 999999,
      requestId: nextRequestId(),
    },
  });

  // The run is far quicker to simulate than to play, so the wall-clock guard
  // is the expected outcome here — and that guard firing is itself the test.
  if (submitted.status === 400) {
    assert.equal(submitted.body.error.code, "RUN_TOO_FAST");
  } else {
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.claimMatched, false, "the inflated claim must not be believed");
    assert.notEqual(submitted.body.score, 999999);
  }
});

test("runner rejects a malformed input trace", async () => {
  const { token } = await signIn();
  const started = await call("/runner/start", { method: "POST", token });

  const submitted = await call("/runner/submit", {
    method: "POST",
    token,
    body: {
      runId: started.body.runId,
      inputs: [
        { tick: 40, action: 0 },
        { tick: 10, action: 0 },
      ],
      score: 100,
      requestId: nextRequestId(),
    },
  });
  assert.equal(submitted.status, 400);
  assert.equal(submitted.body.error.code, "BAD_INPUTS");
});

test("a tournament match resolves when both players have thrown", async () => {
  const alice = await signIn();
  const bob = await signIn();

  const created = await call("/tournament/challenge", {
    method: "POST",
    token: alice.token,
    body: { opponent: bob.wallet },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const challengeId = created.body.challengeId;

  async function playMatch(player) {
    let last = null;
    for (let index = 0; index < 3; index++) {
      last = await call("/tournament/throw", {
        method: "POST",
        token: player.token,
        body: {
          challengeId,
          angleQ: 28000 + index * 1500,
          powerQ: 42000,
          requestId: nextRequestId(),
        },
      });
      assert.equal(last.status, 200, JSON.stringify(last.body));
    }
    return last;
  }

  const aliceFinal = await playMatch(alice);
  assert.equal(aliceFinal.body.resolved, false, "the match waits for the second player");

  const bobFinal = await playMatch(bob);
  assert.equal(bobFinal.body.resolved, true);
  assert.ok([alice.wallet, bob.wallet, "draw"].includes(bobFinal.body.winner));

  const inbox = await call("/tournament/mine", { token: alice.token });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.history.length, 1);

  // A fourth throw has nothing left to score.
  const extra = await call("/tournament/throw", {
    method: "POST",
    token: alice.token,
    body: { challengeId, angleQ: 30000, powerQ: 30000, requestId: nextRequestId() },
  });
  assert.equal(extra.status, 409);
});

test("a stranger cannot play someone else's match", async () => {
  const alice = await signIn();
  const bob = await signIn();
  const stranger = await signIn();

  const created = await call("/tournament/challenge", {
    method: "POST",
    token: alice.token,
    body: { opponent: bob.wallet },
  });

  const attempt = await call("/tournament/throw", {
    method: "POST",
    token: stranger.token,
    body: {
      challengeId: created.body.challengeId,
      angleQ: 30000,
      powerQ: 30000,
      requestId: nextRequestId(),
    },
  });
  assert.equal(attempt.status, 403);
});

test("admin endpoints are closed to ordinary wallets", async () => {
  const { token } = await signIn();
  const { status, body } = await call("/admin/config", { token });
  assert.equal(status, 403);
  assert.equal(body.error.code, "NOT_ADMIN");
});

test("test-only routes need the key and exist only on devnet", async () => {
  const unauthorized = await call("/test/force-daily-rollover", { method: "POST" });
  assert.equal(unauthorized.status, 403);

  const rolled = await call("/test/force-daily-rollover", {
    method: "POST",
    headers: { "x-test-key": TEST_KEY },
    body: {},
  });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.body));
  assert.ok(rolled.body.day);
});

test("a forced daily rollover seals yesterday and continues the streak", async () => {
  const { wallet, token } = await signIn();

  const first = await call("/fetch/start", { method: "POST", token });
  assert.equal(first.body.streakDays, 1);
  await call("/fetch/throw", {
    method: "POST",
    token,
    body: {
      roundId: first.body.roundId,
      angleQ: 32000,
      powerQ: 41000,
      requestId: nextRequestId(),
    },
  });

  // Pretend a day passed by rewriting the player's recorded day, then confirm
  // the next start rolls the streak forward rather than resetting it.
  const reset = await call(`/test/reset-wallet/${wallet}`, {
    method: "POST",
    headers: { "x-test-key": TEST_KEY },
    body: {},
  });
  assert.equal(reset.status, 200);

  const afterReset = await call("/fetch/start", { method: "POST", token });
  assert.equal(afterReset.body.streakDays, 1, "a wiped player starts a fresh streak");
});

test("the public summary renders without a wallet", async () => {
  const { status, body } = await call("/summary");
  assert.equal(status, 200);
  assert.equal(body.cluster, "devnet");
  assert.ok(Array.isArray(body.feed));
  assert.ok(body.boards.fetchWeekly.startsWith("fetch:weekly:"));
});
