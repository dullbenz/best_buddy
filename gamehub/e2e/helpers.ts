/**
 * Shared plumbing for the browser tests.
 *
 * The only unusual part is the wallet. Playwright cannot drive a browser
 * extension, so each test injects an ephemeral ed25519 key into the page before
 * any script runs; `src/testWallet.ts` picks it up and registers itself as a
 * Wallet Standard wallet, which the Solana adapter then discovers on its own.
 * From the app's point of view nothing is different from a real wallet.
 */
import { type Page, expect } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";

export type TestWallet = { address: string; secret: string };

export function makeWallet(): TestWallet {
  const keypair = nacl.sign.keyPair();
  return {
    address: bs58.encode(Buffer.from(keypair.publicKey)),
    secret: bs58.encode(Buffer.from(keypair.secretKey)),
  };
}

/**
 * The wallet that actually holds a stake on devnet, if the suite was given it.
 *
 * Perk gating is a fact about the chain, so it can only be tested against a
 * wallet that really has staked. Absent the secret the perk tests skip rather
 * than pretend: the emulator's stake stub reports every wallet as staked, so
 * running them locally would assert the stub, not the gate.
 */
export function stakedWallet(): TestWallet | null {
  const secret = process.env.E2E_STAKED_WALLET_SECRET;
  if (!secret) return null;
  const keypair = nacl.sign.keyPair.fromSecretKey(bs58.decode(secret));
  return { address: bs58.encode(Buffer.from(keypair.publicKey)), secret };
}

/** Inject a wallet, then load a page. Must happen before the app boots. */
export async function visit(page: Page, path: string, wallet?: TestWallet) {
  if (wallet) {
    await page.addInitScript((secret) => {
      (window as any).__E2E_WALLET_SECRET__ = secret;
    }, wallet.secret);
  }
  await page.goto(path);
}

/** Connect the injected wallet through the real adapter UI. */
export async function connect(page: Page) {
  const button = page.getByRole("button", { name: /select wallet|connect/i }).first();
  await button.click();

  const option = page.getByRole("button", { name: /E2E Test Wallet/i });
  await option.click();

  // The adapter renders the connected address in the same button.
  await expect(page.locator(".wallet-adapter-button-trigger")).not.toHaveText(/select wallet/i, {
    timeout: 15_000,
  });
}

/**
 * Connect, then complete sign-in-with-Solana.
 *
 * Waits for the rank badge in the header, which only renders once the session
 * exists AND `/me` has come back. Waiting for the sign-in button to disappear
 * is not enough: its label changes to "check your wallet…" the instant it is
 * clicked, so the test would sail on and play the next move as a guest.
 */
export async function signIn(page: Page) {
  await connect(page);

  const button = page.getByRole("button", { name: /^sign in$/i }).first();
  await button.click();

  // Against a deployed environment the first call of the day pays a cold start
  // on both the API and Firebase Auth, and the click can land before the
  // handler is wired. Retry the click while waiting rather than failing the
  // whole suite on a slow first request; a genuinely broken sign-in still fails,
  // it just takes the full timeout to say so.
  await expect(async () => {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => {});
    }
    await expect(page.locator("header .rank-badge")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

/**
 * Start a guest session through the UI. The guest pill is the readiness
 * signal — guests never get the rank badge, because they have no profile.
 */
export async function signInAsGuest(page: Page) {
  await page.getByRole("button", { name: /play as a guest/i }).first().click();
  await expect(page.getByTestId("guest-badge")).toBeVisible({ timeout: 30_000 });
}

/**
 * Trade a custom token for an ID token the way the SDK would — against the
 * Auth emulator locally, against real Firebase Auth for a deployed target
 * (which needs the web API key in E2E_FIREBASE_API_KEY).
 */
async function exchangeCustomToken(page: Page, customToken: string): Promise<string> {
  const url = process.env.E2E_BASE_URL
    ? `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.E2E_FIREBASE_API_KEY}`
    : `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;
  const exchange = await page.request.post(url, {
    data: { token: customToken, returnSecureToken: true },
  });
  const session = await exchange.json();
  if (!session.idToken) throw new Error(`token exchange failed: ${JSON.stringify(session)}`);
  return session.idToken;
}

/** A guest API token, for seeding data without driving the UI. */
export async function apiGuestToken(page: Page): Promise<string> {
  const minted = await page.request.post("/api/auth/guest", { data: {} });
  const body = await minted.json();
  return exchangeCustomToken(page, body.token);
}

/**
 * An admin API token, or null when this environment has no admin to offer.
 *
 * Locally the fixed test-admin keypair (seed public on purpose, allowlisted
 * only in emulator env files) walks the real challenge/verify path. Against a
 * deployed target the suite needs E2E_ADMIN_WALLET_SECRET, and callers skip
 * rather than fail when it is absent — the stakedWallet() doctrine.
 */
export async function apiAdminToken(page: Page): Promise<string | null> {
  let keypair: nacl.SignKeyPair;
  if (process.env.E2E_BASE_URL) {
    const secret = process.env.E2E_ADMIN_WALLET_SECRET;
    if (!secret) return null;
    keypair = nacl.sign.keyPair.fromSecretKey(bs58.decode(secret));
  } else {
    keypair = nacl.sign.keyPair.fromSeed(Buffer.from("buddy-gamehub-test-admin-0000001"));
  }
  const wallet = bs58.encode(Buffer.from(keypair.publicKey));

  const challenge = await (
    await page.request.post("/api/auth/challenge", { data: { wallet } })
  ).json();
  const signature = bs58.encode(
    Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey),
    ),
  );
  const verified = await (
    await page.request.post("/api/auth/verify", {
      data: { wallet, nonce: challenge.nonce, signature },
    })
  ).json();
  if (!verified.token) throw new Error(`admin verify failed: ${JSON.stringify(verified)}`);
  return exchangeCustomToken(page, verified.token);
}

/** A five-question quiz whose correct answer is always the "right" option. */
export function quizPayload(title = `E2E Quiz ${Date.now()}`) {
  const wallet = makeWallet();
  return {
    template: "quiz",
    title,
    intro: "Seeded by the browser suite.",
    payoutWallet: wallet.address,
    items: Array.from({ length: 5 }, (unused, index) => ({
      prompt: `Question ${index + 1}: pick the right one?`,
      options: ["right", "wrong", "also wrong"],
      answer: 0,
    })),
  };
}

/**
 * Author a trick as a fresh guest and approve it as the admin. Returns null
 * when the environment offers no admin session — callers skip.
 */
export async function seedApprovedTrick(page: Page, payload = quizPayload()): Promise<string | null> {
  const adminToken = await apiAdminToken(page);
  if (!adminToken) return null;

  const guestToken = await apiGuestToken(page);
  const submitted = await page.request.post("/api/tricks/submit", {
    headers: { authorization: `Bearer ${guestToken}` },
    data: { ...payload, requestId: `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
  });
  const body = await submitted.json();
  if (!body.trickId) throw new Error(`trick submit failed: ${JSON.stringify(body)}`);

  const approved = await page.request.post(`/api/admin/tricks/${body.trickId}/approve`, {
    headers: { authorization: `Bearer ${adminToken}` },
    data: {},
  });
  if (!approved.ok()) throw new Error(`approve failed: ${await approved.text()}`);
  return body.trickId;
}

/** The devnet-only test routes, for rolling time forward. */
export async function forceJob(
  page: Page,
  job: "force-daily-rollover" | "force-weekly-rollover",
  testKey = process.env.GAMEHUB_TEST_KEY || "local-test-key",
) {
  return page.request.post(`/api/test/${job}`, {
    headers: { "x-test-key": testKey, "content-type": "application/json" },
    data: {},
  });
}
