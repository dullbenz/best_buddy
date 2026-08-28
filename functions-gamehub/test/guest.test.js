/**
 * Guest sessions: an identity without a wallet.
 *
 * Guests exist so community tricks can be played and authored without
 * connecting anything. These tests pin the boundaries: a guest is a real,
 * distinct identity, and everything wallet-keyed refuses it cleanly.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { call, signInAsGuest, MAINNET_BASE, nextRequestId } from "./helpers.js";

test("a guest gets a real session and a guest-shaped /me", async () => {
  const guest = await signInAsGuest();
  assert.match(guest.playerId, /^g:[0-9a-f]{32}$/);

  const me = await call("/me", { token: guest.token });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.guest, true);
  assert.equal(me.body.wallet, null);
  assert.equal(me.body.playerId, guest.playerId);
  assert.equal(me.body.admin, false);
  assert.equal(me.body.stake, null);
  assert.equal(me.body.perks.goldenBone, false);
});

// The regression test for the uid split: `devnet:g:{hex}` must not collapse
// to the identity "g" — two guests are two people.
test("two guests are two distinct identities", async () => {
  const first = await signInAsGuest();
  const second = await signInAsGuest();
  assert.notEqual(first.playerId, second.playerId);

  const [me1, me2] = await Promise.all([
    call("/me", { token: first.token }),
    call("/me", { token: second.token }),
  ]);
  assert.notEqual(me1.body.playerId, me2.body.playerId);
});

test("the wallet-keyed games refuse a guest", async () => {
  const guest = await signInAsGuest();

  const pet = await call("/pet", {
    method: "POST",
    token: guest.token,
    body: { requestId: nextRequestId() },
  });
  assert.equal(pet.status, 403);
  assert.equal(pet.body.error.code, "GUEST_NOT_ALLOWED");

  const fetchStart = await call("/fetch/start", {
    method: "POST",
    token: guest.token,
    body: { requestId: nextRequestId() },
  });
  assert.equal(fetchStart.status, 403);
  assert.equal(fetchStart.body.error.code, "GUEST_NOT_ALLOWED");
});

test("a guest can browse the current hunt without tripping the stake lookup", async () => {
  const guest = await signInAsGuest();
  const current = await call("/hunt/current", { token: guest.token });
  assert.equal(current.status, 200, JSON.stringify(current.body));
  // With or without an active hunt, no shovel count is offered to a guest.
  if (current.body.hunt) assert.equal(current.body.shovels, null);
});

test("a guest minted for one cluster is refused by the other", async () => {
  const guest = await signInAsGuest({ base: MAINNET_BASE });
  const me = await call("/me", { token: guest.token });
  assert.equal(me.status, 401);
  assert.equal(me.body.error.code, "WRONG_CLUSTER");
});

test("admin endpoints are closed to guests", async () => {
  const guest = await signInAsGuest();
  const pending = await call("/admin/config", { token: guest.token });
  assert.equal(pending.status, 403);
});

// Runs against the mainnet-shaped export: rate buckets are per cluster, and
// exhausting the devnet bucket would starve the other suites, which mint
// their guests from this same IP in parallel processes.
test("guest minting is rate-limited per IP", async () => {
  let limited = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const minted = await call("/auth/guest", { method: "POST", base: MAINNET_BASE });
    if (minted.status === 429) {
      limited = minted;
      break;
    }
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
  }
  assert.ok(limited, "never hit the guest mint limit");
});
