/**
 * The weekly judging: crowning a trick, paying its creator, and keeping the
 * snapshot's hash honest through an admin override.
 *
 * These drive the real forced rollover on the devnet export. The `at`
 * passed to it is chosen so the closing week is always the current ISO week,
 * whatever day the suite runs on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { weekId } from "../db.js";
import {
  call,
  signIn,
  signInAsGuest,
  signInAsAdmin,
  nextRequestId,
  MAINNET_BASE,
  TEST_KEY,
} from "./helpers.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-gamehub" });
const adminDb = getFirestore();

const PAYOUT_A = bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey));
const PAYOUT_B = bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey));

function quiz(title, payoutWallet) {
  return {
    template: "quiz",
    title,
    intro: "",
    payoutWallet,
    items: Array.from({ length: 5 }, (unused, index) => ({
      prompt: `Q${index}?`,
      options: ["yes", "no"],
      answer: 0,
    })),
  };
}

async function authorApproved(admin, payload) {
  const creator = await signInAsGuest();
  const submitted = await call("/tricks/submit", {
    method: "POST",
    token: creator.token,
    body: { ...payload, requestId: nextRequestId() },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const trickId = submitted.body.trickId;
  const approved = await call(`/admin/tricks/${trickId}/approve`, {
    method: "POST",
    token: admin.token,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return trickId;
}

async function playAs(session, trickId) {
  const started = await call(`/tricks/${trickId}/start`, { method: "POST", token: session.token });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const submitted = await call(`/tricks/${trickId}/submit`, {
    method: "POST",
    token: session.token,
    body: {
      answers: Array.from({ length: started.body.itemCount }, () => 0),
      ticks: Array.from({ length: started.body.itemCount }, () => 100),
      requestId: nextRequestId(),
    },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
}

async function rateAs(session, trickId, originality, fun) {
  const rated = await call(`/tricks/${trickId}/rate`, {
    method: "POST",
    token: session.token,
    body: { originality, fun, requestId: nextRequestId() },
  });
  assert.equal(rated.status, 200, JSON.stringify(rated.body));
}

/** An `at` whose closing week is the current ISO week on any weekday. */
function rolloverAt() {
  const now = new Date();
  const yesterdaySameWeek = weekId(new Date(now.getTime() - 86400000)) === weekId(now);
  return yesterdaySameWeek ? now : new Date(now.getTime() + 86400000);
}

const shaOf = (cycleDoc) =>
  createHash("sha256")
    .update(JSON.stringify({ cluster: "devnet", cycle: cycleDoc.cycle, winners: cycleDoc.winners }))
    .digest("hex");

test("the weekly rollover crowns the best-rated trick and pays its creator", async () => {
  const admin = await signInAsAdmin();
  const trickA = await authorApproved(admin, quiz("The Favourite", PAYOUT_A));
  const trickB = await authorApproved(admin, quiz("The Runner-Up", PAYOUT_B));

  // Ten players carry trickA over the plays floor; five of them rate it high.
  for (let index = 0; index < 10; index += 1) {
    const player = await signIn();
    await playAs(player, trickA);
    if (index < 5) await rateAs(player, trickA, 5, 5);
  }
  // trickB stays under the raters floor: popular is not the same as judged.
  for (let index = 0; index < 3; index += 1) {
    const player = await signIn();
    await playAs(player, trickB);
    if (index < 1) await rateAs(player, trickB, 5, 5);
  }

  const at = rolloverAt();
  const week = weekId(at);
  const cycle = weekId(new Date(at.getTime() - 86400000));
  const rolled = await call("/test/force-weekly-rollover", {
    method: "POST",
    headers: { "x-test-key": TEST_KEY },
    body: { at: at.toISOString() },
  });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.body));

  const shelf = await call("/tricks");
  assert.equal(shelf.body.featured?.trickId, trickA, JSON.stringify(shelf.body.featured));
  assert.equal(shelf.body.featured.trick.featuredWeek, week);

  const snapshot = await call(`/admin/prize-cycle/${cycle}`, { token: admin.token });
  assert.equal(snapshot.status, 200);
  const row = snapshot.body.winners.find((winner) => winner.game === "tricks");
  assert.ok(row, "no creator row in the snapshot");
  assert.equal(row.wallet, PAYOUT_A);
  assert.equal(row.trickId, trickA);
  assert.equal(row.prizeBuddy, 100000);
  assert.equal(row.board, `tricks:weekly:${cycle}`);
  // The internal consistency the payout script enforces: the stored hash is
  // the hash of the stored winners.
  assert.equal(snapshot.body.artifactSha256, shaOf(snapshot.body));

  // Playing the featured trick now lands on the weekly race board too.
  const late = await signInAsGuest();
  await playAs(late, trickA);
  const board = await call(`/leaderboard/tricks:weekly:${week}`);
  assert.ok(
    board.body.top.some((entry) => entry.wallet === late.playerId),
    "featured-week board missed the play",
  );

  // The override swaps the pick, rewrites the winner row, and moves the hash.
  const overridden = await call(`/admin/tricks/feature/${week}`, {
    method: "POST",
    token: admin.token,
    body: { trickId: trickB },
  });
  assert.equal(overridden.status, 200, JSON.stringify(overridden.body));
  assert.equal(overridden.body.rewroteCycle, true);

  const rewritten = await call(`/admin/prize-cycle/${cycle}`, { token: admin.token });
  const newRow = rewritten.body.winners.find((winner) => winner.game === "tricks");
  assert.equal(newRow.trickId, trickB);
  assert.equal(newRow.wallet, PAYOUT_B);
  assert.equal(rewritten.body.artifactSha256, shaOf(rewritten.body));
  assert.notEqual(rewritten.body.artifactSha256, snapshot.body.artifactSha256);
  assert.equal(
    rewritten.body.totalBuddy,
    rewritten.body.winners.reduce((sum, winner) => sum + winner.prizeBuddy, 0),
  );

  // The un-featured trick becomes eligible again; the new pick is flagged.
  const [aDoc, bDoc] = await Promise.all([
    adminDb.doc(`gamehub/devnet/tricks/${trickA}`).get(),
    adminDb.doc(`gamehub/devnet/tricks/${trickB}`).get(),
  ]);
  assert.equal(aDoc.data().featuredWeek, null);
  assert.equal(bDoc.data().featuredWeek, week);

  // Once the snapshot is paid it is a record, not a draft.
  const paid = await call(`/admin/prize-cycle/${cycle}/mark-paid`, {
    method: "POST",
    token: admin.token,
    body: { txSignatures: ["e2e-rehearsal"], receiptUrl: "/receipts/devnet/e2e.json" },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const refused = await call(`/admin/tricks/feature/${week}`, {
    method: "POST",
    token: admin.token,
    body: { trickId: trickA },
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, "CYCLE_PAID");
});

test("a week with nothing eligible crowns nothing and pays nothing", async () => {
  const admin = await signInAsAdmin();
  // Far enough ahead that no weeklyStats exist for the closing week, and far
  // enough that it cannot collide with the real cycle above.
  const at = new Date(Date.now() + 21 * 86400000);
  const rolled = await call("/test/force-weekly-rollover", {
    method: "POST",
    headers: { "x-test-key": TEST_KEY },
    body: { at: at.toISOString() },
  });
  assert.equal(rolled.status, 200);

  const cycle = weekId(new Date(at.getTime() - 86400000));
  const snapshot = await call(`/admin/prize-cycle/${cycle}`, { token: admin.token });
  assert.ok(!snapshot.body.winners.some((winner) => winner.game === "tricks"));
  const featured = await adminDb.doc(`gamehub/devnet/featuredTricks/${weekId(at)}`).get();
  assert.equal(featured.exists, false);
});

test("a stored prize table cannot shadow a new board's default", async () => {
  // On the mainnet-shaped export, so patching config pollutes nothing the
  // other suites read.
  const admin = await signInAsAdmin({ base: MAINNET_BASE });
  const patched = await call("/admin/config", {
    method: "POST",
    token: admin.token,
    base: MAINNET_BASE,
    body: { config: { prizeTable: { "fetch:weekly": [1] } } },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.deepEqual(patched.body.config.prizeTable["fetch:weekly"], [1]);
  // The patch restated nothing about tricks, and the default survives anyway.
  assert.deepEqual(patched.body.config.prizeTable["tricks:weekly"], [100000]);
  assert.deepEqual(patched.body.config.prizeTable["pet:weekly"], [250000, 150000, 100000, 50000, 50000]);
});
