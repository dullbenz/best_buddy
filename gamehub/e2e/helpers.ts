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
