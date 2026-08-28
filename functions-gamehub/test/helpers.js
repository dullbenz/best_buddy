/**
 * Shared plumbing for the emulator API suites.
 *
 * Everything here goes over real HTTP to the emulated functions and Auth —
 * nothing is mocked. `api.test.js` predates this module and carries its own
 * copies; new suites import from here.
 */
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-gamehub";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

/** The staging (devnet) export — the one the suites exercise. */
export const BASE = `http://${FUNCTIONS_HOST}/${PROJECT}/us-central1/gamehubApiStaging/api`;
/** The production-shaped (mainnet-beta) export, for cross-cluster tests. */
export const MAINNET_BASE = `http://${FUNCTIONS_HOST}/${PROJECT}/us-central1/gamehubApi/api`;
export const TEST_KEY = process.env.GAMEHUB_TEST_KEY || "local-test-key";

let requestCounter = 0;
export const nextRequestId = () => `req-${Date.now()}-${requestCounter++}`;

export async function call(path, { method = "GET", body, token, headers = {}, base = BASE } = {}) {
  const response = await fetch(`${base}${path}`, {
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

/** Trade a custom token for an ID token exactly as the browser SDK would. */
export async function exchangeCustomToken(customToken) {
  const exchange = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const session = await exchange.json();
  assert.ok(session.idToken, `no id token: ${JSON.stringify(session)}`);
  return session.idToken;
}

/** A throwaway wallet, signed in for real against the given export. */
export async function signIn({ base = BASE, keypair = nacl.sign.keyPair() } = {}) {
  const wallet = bs58.encode(Buffer.from(keypair.publicKey));

  const challenge = await call("/auth/challenge", { method: "POST", body: { wallet }, base });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));

  const signature = bs58.encode(
    Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(challenge.body.message), keypair.secretKey),
    ),
  );

  const verified = await call("/auth/verify", {
    method: "POST",
    body: { wallet, nonce: challenge.body.nonce, signature },
    base,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));

  return { wallet, keypair, token: await exchangeCustomToken(verified.body.token), challenge: challenge.body };
}

/** A guest session, minted for real against the given export. */
export async function signInAsGuest({ base = BASE } = {}) {
  const minted = await call("/auth/guest", { method: "POST", base });
  assert.equal(minted.status, 200, JSON.stringify(minted.body));
  return { playerId: minted.body.playerId, token: await exchangeCustomToken(minted.body.token) };
}
