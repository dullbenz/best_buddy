/**
 * Community tricks: authoring, moderation, play, rating, reporting.
 *
 * Same doctrine as the rest of the suite — each flow's happy path plus the
 * ways it can be cheated, because the second half is the half worth testing.
 * DB-level assertions go through the Admin SDK against the emulator: some
 * guarantees (a guest minting no ledger docs, answers absent from the public
 * doc) are about what is NOT written, and no API response can prove that.
 */
import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { call, signIn, signInAsGuest, signInAsAdmin, nextRequestId } from "./helpers.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-gamehub" });
const adminDb = getFirestore();
const devnetDoc = (collection, id) =>
  adminDb.collection("gamehub").doc("devnet").collection(collection).doc(id);

const PAYOUT_WALLET = bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey));

/** A valid five-question quiz whose answers are all option 0. */
function quizPayload(overrides = {}) {
  return {
    template: "quiz",
    title: "Buddy Lore",
    intro: "Five questions about the record.",
    payoutWallet: PAYOUT_WALLET,
    items: Array.from({ length: 5 }, (unused, index) => ({
      prompt: `Question ${index + 1}?`,
      options: ["right", "wrong", "also wrong"],
      answer: 0,
    })),
    ...overrides,
  };
}

async function author(session, payload = quizPayload()) {
  const submitted = await call("/tricks/submit", {
    method: "POST",
    token: session.token,
    body: { ...payload, requestId: nextRequestId() },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return submitted.body.trickId;
}

async function approve(admin, trickId) {
  const approved = await call(`/admin/tricks/${trickId}/approve`, {
    method: "POST",
    token: admin.token,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
}

/** Start and submit one attempt; answers default to all-correct for a quiz. */
async function play(session, trickId, { answers, ticks } = {}) {
  const started = await call(`/tricks/${trickId}/start`, { method: "POST", token: session.token });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const count = started.body.itemCount;
  const submitted = await call(`/tricks/${trickId}/submit`, {
    method: "POST",
    token: session.token,
    body: {
      answers: answers ?? Array.from({ length: count }, () => 0),
      ticks: ticks ?? Array.from({ length: count }, () => 100),
      requestId: nextRequestId(),
    },
  });
  return { started: started.body, submitted };
}

test("authoring validates and lands as pending, invisible and unplayable", async () => {
  const creator = await signInAsGuest();
  const admin = await signInAsAdmin();

  for (const [broken, code] of [
    [quizPayload({ payoutWallet: "not-a-wallet" }), "BAD_PAYOUT"],
    [quizPayload({ template: "karaoke" }), "BAD_TEMPLATE"],
    [quizPayload({ items: quizPayload().items.slice(0, 2) }), "BAD_ITEM_COUNT"],
    [
      quizPayload({ items: quizPayload().items.map((item) => ({ ...item, answer: 9 })) }),
      "BAD_ANSWER",
    ],
    [quizPayload({ title: "" }), "NO_TITLE"],
  ]) {
    const rejected = await call("/tricks/submit", {
      method: "POST",
      token: creator.token,
      body: { ...broken, requestId: nextRequestId() },
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, code);
  }

  const trickId = await author(creator);

  const shelf = await call("/tricks");
  assert.equal(shelf.status, 200);
  assert.ok(!shelf.body.tricks.some((trick) => trick.trickId === trickId), "pending on the shelf");

  const player = await signInAsGuest();
  const started = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  assert.equal(started.status, 404);

  // A stranger sees nothing; the creator and an admin see the pending trick.
  const asStranger = await call(`/tricks/${trickId}`, { token: player.token });
  assert.equal(asStranger.status, 404);
  const asCreator = await call(`/tricks/${trickId}`, { token: creator.token });
  assert.equal(asCreator.status, 200);
  assert.equal(asCreator.body.you.isCreator, true);
  const asAdmin = await call(`/tricks/${trickId}`, { token: admin.token });
  assert.equal(asAdmin.status, 200);

  // The public document never carries answers, in the API or in Firestore.
  assert.ok(!JSON.stringify(asCreator.body.trick.items).includes("answer"));
  const stored = await devnetDoc("tricks", trickId).get();
  assert.ok(!JSON.stringify(stored.data().items).includes("answer"));
  assert.equal(stored.data().items[0].options.length, 3);
});

test("one submission a day, and the pending queue is capped", async () => {
  const creator = await signInAsGuest();
  await author(creator);
  const second = await call("/tricks/submit", {
    method: "POST",
    token: creator.token,
    body: { ...quizPayload(), requestId: nextRequestId() },
  });
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, "SUBMISSION_CAP");
});

test("approval puts a trick on the shelf and only admins can grant it", async () => {
  const creator = await signInAsGuest();
  const trickId = await author(creator);

  const ordinary = await signIn();
  const denied = await call(`/admin/tricks/${trickId}/approve`, {
    method: "POST",
    token: ordinary.token,
  });
  assert.equal(denied.status, 403);
  const listDenied = await call("/admin/tricks/pending", { token: ordinary.token });
  assert.equal(listDenied.status, 403);

  const admin = await signInAsAdmin();
  const queue = await call("/admin/tricks/pending", { token: admin.token });
  assert.equal(queue.status, 200);
  const inQueue = queue.body.pending.find((trick) => trick.trickId === trickId);
  assert.ok(inQueue, "not in the review queue");
  // Review needs the key: the queue is the one place answers appear.
  assert.deepEqual(inQueue.answers, [0, 0, 0, 0, 0]);

  await approve(admin, trickId);
  const again = await call(`/admin/tricks/${trickId}/approve`, {
    method: "POST",
    token: admin.token,
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "BAD_TRANSITION");

  const shelf = await call("/tricks");
  assert.ok(shelf.body.tricks.some((trick) => trick.trickId === trickId), "not on the shelf");
});

test("a guest plays onto the trick board without ever touching the ledger", async () => {
  const creator = await signInAsGuest();
  const admin = await signInAsAdmin();
  const trickId = await author(creator);
  await approve(admin, trickId);

  const player = await signInAsGuest();
  const { submitted } = await play(player, trickId, { answers: [0, 0, 0, 1, 0] });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.pointsAwarded, 0);
  assert.deepEqual(submitted.body.correct, [true, true, true, false, true]);
  assert.deepEqual(submitted.body.answers, [0, 0, 0, 0, 0]);
  assert.ok(submitted.body.score > 0);

  const board = await call(`/leaderboard/tricks:game:${trickId}`);
  assert.equal(board.status, 200, JSON.stringify(board.body));
  const entry = board.body.top.find((row) => row.wallet === player.playerId);
  assert.ok(entry, "guest missing from the trick board");
  assert.equal(entry.points, submitted.body.score);

  // What was NOT written is the point: no ledger, no profile, no GBP.
  const [playerDoc, profileDoc] = await Promise.all([
    devnetDoc("players", player.playerId).get(),
    devnetDoc("profiles", player.playerId).get(),
  ]);
  assert.equal(playerDoc.exists, false);
  assert.equal(profileDoc.exists, false);
});

test("one attempt a day: a second start resumes, a scored day refuses", async () => {
  const creator = await signInAsGuest();
  const admin = await signInAsAdmin();
  const trickId = await author(creator);
  await approve(admin, trickId);

  const player = await signInAsGuest();
  const first = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  const second = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  assert.equal(second.status, 200);
  assert.equal(second.body.resumed, true);
  assert.equal(second.body.seed, first.body.seed);

  const submitted = await call(`/tricks/${trickId}/submit`, {
    method: "POST",
    token: player.token,
    body: { answers: [0, 0, 0, 0, 0], ticks: [100, 100, 100, 100, 100], requestId: nextRequestId() },
  });
  assert.equal(submitted.status, 200);

  const third = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  assert.equal(third.status, 409);
  assert.equal(third.body.error.code, "ALREADY_PLAYED");
});

test("a replayed requestId scores once, and claimed ticks must fit the clock", async () => {
  const creator = await signInAsGuest();
  const admin = await signInAsAdmin();
  const trickId = await author(creator);
  await approve(admin, trickId);

  const player = await signInAsGuest();
  await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });

  // Ticks summing far past wall clock + grace: the speed bonus would belong
  // to whoever edits the payload.
  const dishonest = await call(`/tricks/${trickId}/submit`, {
    method: "POST",
    token: player.token,
    body: {
      answers: [0, 0, 0, 0, 0],
      ticks: [20000, 20000, 20000, 20000, 20000],
      requestId: nextRequestId(),
    },
  });
  assert.equal(dishonest.status, 400);
  assert.equal(dishonest.body.error.code, "TICKS_MISMATCH");

  const requestId = nextRequestId();
  const body = { answers: [0, 0, 0, 0, 0], ticks: [100, 100, 100, 100, 100], requestId };
  const once = await call(`/tricks/${trickId}/submit`, { method: "POST", token: player.token, body });
  assert.equal(once.status, 200);
  const replay = await call(`/tricks/${trickId}/submit`, { method: "POST", token: player.token, body });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, once.body);

  const detail = await call(`/tricks/${trickId}`, { token: player.token });
  assert.equal(detail.body.trick.playCount, 1);
});

test("wallet play awards capped GBP under the literal 'tricks' source", async () => {
  const admin = await signInAsAdmin();
  const creatorA = await signInAsGuest();
  const creatorB = await signInAsGuest();
  const trickA = await author(creatorA);
  const trickB = await author(creatorB);
  await approve(admin, trickA);
  await approve(admin, trickB);

  const player = await signIn();
  const first = await play(player, trickA);
  assert.equal(first.submitted.status, 200, JSON.stringify(first.submitted.body));
  // Perfect fast play outscores the daily cap, so the ledger takes the cap
  // while the board keeps the full score.
  assert.ok(first.submitted.body.score > 500, `score ${first.submitted.body.score}`);
  assert.equal(first.submitted.body.pointsAwarded, 500);
  assert.equal(first.submitted.body.capped, true);

  const second = await play(player, trickB);
  assert.equal(second.submitted.status, 200);
  assert.equal(second.submitted.body.pointsAwarded, 0);

  const profile = await devnetDoc("profiles", player.wallet).get();
  assert.equal(profile.data().sources.tricks, 500);
  assert.equal(profile.data().gbp, 500);
  // The field-name trap: a trick id must never become a profile source key.
  for (const key of Object.keys(profile.data().sources)) {
    assert.ok(!/^[0-9a-f]{24}$/.test(key), `trick id leaked into sources: ${key}`);
  }

  const board = await call(`/leaderboard/tricks:game:${trickA}`);
  const entry = board.body.top.find((row) => row.wallet === player.wallet);
  assert.equal(entry.points, first.submitted.body.score);
});

test("ratings need a finished play, never your own trick, one vote each", async () => {
  const admin = await signInAsAdmin();
  const creator = await signIn();
  const trickId = await author(creator);
  await approve(admin, trickId);

  const rater = await signIn();
  const early = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: rater.token,
    body: { originality: 5, fun: 5, requestId: nextRequestId() },
  });
  assert.equal(early.status, 403);
  assert.equal(early.body.error.code, "NOT_PLAYED");

  await play(rater, trickId);
  const bad = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: rater.token,
    body: { originality: 6, fun: 0, requestId: nextRequestId() },
  });
  assert.equal(bad.status, 400);

  const rated = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: rater.token,
    body: { originality: 4, fun: 5, requestId: nextRequestId() },
  });
  assert.equal(rated.status, 200);

  // A re-rate replaces the opinion; the count must not move.
  const rerated = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: rater.token,
    body: { originality: 2, fun: 3, requestId: nextRequestId() },
  });
  assert.equal(rerated.status, 200);
  assert.equal(rerated.body.changed, true);

  const detail = await call(`/tricks/${trickId}`, { token: rater.token });
  assert.equal(detail.body.trick.ratingCount, 1);
  assert.equal(detail.body.trick.originalitySum, 2);
  assert.equal(detail.body.trick.funSum, 3);
  assert.equal(detail.body.you.rated, true);

  // The creator plays their own trick fine, but their rating is refused.
  await play(creator, trickId);
  const selfRate = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: creator.token,
    body: { originality: 5, fun: 5, requestId: nextRequestId() },
  });
  assert.equal(selfRate.status, 403);
  assert.equal(selfRate.body.error.code, "OWN_TRICK");
});

test("enough reports pause a trick; reinstate puts it back", async () => {
  const admin = await signInAsAdmin();
  const creator = await signInAsGuest();
  const trickId = await author(creator);
  await approve(admin, trickId);

  for (let reporter = 0; reporter < 3; reporter += 1) {
    const session = await signIn();
    await play(session, trickId);
    const flagged = await call(`/tricks/${trickId}/report`, {
      method: "POST",
      token: session.token,
      body: { reason: "not a good trick", requestId: nextRequestId() },
    });
    assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
    // The same player flagging twice is still one flag.
    const repeat = await call(`/tricks/${trickId}/report`, {
      method: "POST",
      token: session.token,
      body: { requestId: nextRequestId() },
    });
    assert.equal(repeat.body.repeated, true);
  }

  const shelf = await call("/tricks");
  assert.ok(!shelf.body.tricks.some((trick) => trick.trickId === trickId), "paused but shelved");
  const player = await signInAsGuest();
  const started = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  assert.equal(started.status, 404);

  const reinstated = await call(`/admin/tricks/${trickId}/reinstate`, {
    method: "POST",
    token: admin.token,
  });
  assert.equal(reinstated.status, 200);
  const back = await call("/tricks");
  assert.ok(back.body.tricks.some((trick) => trick.trickId === trickId), "not reinstated");
});

test("a scramble derives its letters from the seed and grades typed words", async () => {
  const admin = await signInAsAdmin();
  const creator = await signInAsGuest();
  const words = ["buddy", "moonbone", "fetch", "treats", "shovel"];
  const trickId = await author(creator, {
    template: "scramble",
    title: "Word Dog",
    intro: "",
    payoutWallet: PAYOUT_WALLET,
    items: words.map((word) => ({ word, hint: `it's ${word.length} letters` })),
  });
  await approve(admin, trickId);

  const player = await signInAsGuest();
  const started = await call(`/tricks/${trickId}/start`, { method: "POST", token: player.token });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  started.body.extras.forEach((extra, index) => {
    assert.equal(extra.letters.length, words[index].length);
    assert.notEqual(extra.letters, words[index], "scramble showed the answer");
    assert.equal([...extra.letters].sort().join(""), [...words[index]].sort().join(""));
  });

  const submitted = await call(`/tricks/${trickId}/submit`, {
    method: "POST",
    token: player.token,
    body: {
      // Normalisation forgives case and punctuation, same as hunt answers.
      answers: ["Buddy", "moonbone", "FETCH", "treats!", "wrong"],
      ticks: words.map(() => 200),
      requestId: nextRequestId(),
    },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.deepEqual(submitted.body.correct, [true, true, true, true, false]);
  assert.deepEqual(submitted.body.answers, words);
});
