/**
 * The end-to-end suite.
 *
 * Every test drives the real UI against a real API. The @smoke subset runs
 * automatically after each staging deploy; the whole file runs on demand before
 * a release.
 */
import { test, expect } from "@playwright/test";

import { connect, forceJob, makeWallet, signIn, visit } from "./helpers";

test.describe("the hub", () => {
  test("@smoke the arcade renders for a visitor with no wallet", async ({ page }) => {
    await visit(page, "/");

    await expect(page.getByRole("heading", { name: "Buddy", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Pet the Dog/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Daily Fetch/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Buddy vs\. The Rugs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Bone Hunt/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Fetch Tournament/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Best Boy/ })).toBeVisible();

    // The prize cycle is a promise about money; it must be on the front page.
    await expect(page.getByText(/weekly prize cycle/i)).toBeVisible();
  });

  test("@smoke the API is alive and knows which chain it is on", async ({ page }) => {
    await visit(page, "/");
    const response = await page.request.get("/api/healthz");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.cluster).toBe("devnet");
  });

  test("deep links work and unknown paths fall back to the arcade", async ({ page }) => {
    await visit(page, "/ranks");
    await expect(page.getByText(/the ladder/i).first()).toBeVisible();

    await visit(page, "/not-a-real-page");
    await expect(page.getByRole("link", { name: /Pet the Dog/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("sign in", () => {
  test("@smoke a wallet can sign in and gets a profile", async ({ page }) => {
    const wallet = makeWallet();
    await visit(page, "/", wallet);
    await signIn(page);

    const me = await page.request.get("/api/me").then((response) => response.json()).catch(() => null);
    // The page holds the session, not the request context, so assert on the UI.
    await expect(page.getByText(/good boy points/i).first()).toBeVisible();
    expect(me === null || me.error).toBeTruthy();
  });

  test("a guest can play without connecting anything", async ({ page }) => {
    await visit(page, "/pet");
    await expect(page.getByText(/sign in to be counted|not counted/i)).toBeVisible();

    await page.getByRole("button", { name: "Pet Buddy" }).click();
    // No error, no forced modal — the tap just works.
    await expect(page.getByText(/that pet didn't register/i)).toHaveCount(0);
  });
});

test.describe("pet the dog", () => {
  test("@smoke a pet scores a point and then cools down", async ({ page }) => {
    const wallet = makeWallet();
    await visit(page, "/pet", wallet);
    await signIn(page);

    const buddy = page.getByRole("button", { name: "Pet Buddy" });
    await buddy.click();

    // The global counter and the player's own count both move.
    await expect(page.locator(".hud-item", { hasText: "your pets" })).toContainText(/[1-9]/, {
      timeout: 15_000,
    });

    // A second tap straight away must not score.
    await buddy.click();
    await expect(page.getByText(/enjoying that one/i)).toBeVisible();
  });

  test("the milestone bar shows the community total", async ({ page }) => {
    await visit(page, "/pet");
    await expect(page.getByText(/the whole pack, all time/i)).toBeVisible();
    await expect(page.locator(".milestone-track")).toBeVisible();
  });
});

test.describe("daily fetch", () => {
  test("@smoke three throws are scored and then the day is done", async ({ page }) => {
    const wallet = makeWallet();
    await visit(page, "/fetch", wallet);
    await signIn(page);

    const stage = page.locator(".stage svg[role='application']");
    await expect(stage).toBeVisible();

    for (let index = 0; index < 3; index++) {
      // The aim readout renders only while the stage is accepting input, so it
      // is the signal that the previous throw has finished resetting. Pressing
      // space before then is a keypress into a disabled stage.
      await expect(page.getByTestId("aim-readout")).toBeVisible({ timeout: 20_000 });

      // Keyboard mode is the reliable one to drive: hold space, release.
      await page.keyboard.down(" ");
      await page.waitForTimeout(220);
      await page.keyboard.up(" ");

      // A verdict stamp appears once the ball lands.
      await expect(page.locator(".verdict")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".verdict")).toBeHidden({ timeout: 20_000 });
    }

    await expect(page.getByText(/that's your three for today/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/fresh throws in/i)).toBeVisible();
  });

  test("guests get unlimited practice, clearly marked", async ({ page }) => {
    await visit(page, "/fetch");
    await expect(page.getByText(/practice throws · nothing is recorded/i)).toBeVisible();
    await expect(page.locator(".stage-note", { hasText: "practice" })).toBeVisible();
  });
});

test.describe("buddy vs the rugs", () => {
  test("@smoke a run plays, ends, and is recorded", async ({ page }) => {
    const wallet = makeWallet();
    await visit(page, "/runner", wallet);
    await signIn(page);

    await page.getByRole("button", { name: /^play$/i }).click();
    await expect(page.locator("canvas.runner-canvas")).toBeVisible();

    // Do nothing: Buddy meets the first obstacle in about two seconds.
    await expect(page.getByText(/run over/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /run again/i })).toBeVisible();
  });

  test("a guest run is played but not recorded", async ({ page }) => {
    await visit(page, "/runner");
    await page.getByRole("button", { name: /^play$/i }).click();
    await expect(page.getByText(/run over/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sign in to enter the weekly tournament/i)).toBeVisible();
  });
});

test.describe("tournament", () => {
  test("a challenge can be created and played", async ({ page }) => {
    const wallet = makeWallet();
    const rival = makeWallet();
    await visit(page, "/tournament", wallet);
    await signIn(page);

    await page.getByLabel(/opponent wallet address/i).fill(rival.address);
    await page.getByRole("button", { name: /^challenge$/i }).click();

    // The match opens straight into the stage.
    await expect(page.getByText(/same wind, same field/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".stage svg[role='application']")).toBeVisible();

    // Take focus off the button that opened the match: space would otherwise
    // re-activate it instead of charging the throw.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.down(" ");
    await page.waitForTimeout(250);
    await page.keyboard.up(" ");
    await expect(page.locator(".verdict")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("ranks and prizes", () => {
  test("@smoke the ladder and the receipts page render", async ({ page }) => {
    await visit(page, "/ranks");
    await expect(page.getByText("Stray").first()).toBeVisible();
    await expect(page.getByText("Immortal Dog").first()).toBeVisible();

    await visit(page, "/prizes");
    await expect(page.getByText(/weekly, by hand, with receipts/i)).toBeVisible();
    await expect(page.getByText(/squads multisig vault/i)).toBeVisible();
  });

  test("a wallet's public profile is reachable", async ({ page }) => {
    const wallet = makeWallet();
    await visit(page, "/pet", wallet);
    await signIn(page);
    await page.getByRole("button", { name: "Pet Buddy" }).click();
    await page.waitForTimeout(1500);

    await page.goto(`/wallet/${wallet.address}`);
    await expect(page.getByText(/good boy points/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/pets given/i)).toBeVisible();
  });
});

test.describe("time-based flows", () => {
  test("a forced daily rollover seals the boards", async ({ page }) => {
    await visit(page, "/");
    const response = await forceJob(page, "force-daily-rollover");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.day).toBeTruthy();
  });

  test("the test routes refuse a caller without the key", async ({ page }) => {
    await visit(page, "/");
    const response = await page.request.post("/api/test/force-daily-rollover", { data: {} });
    expect(response.status()).toBe(403);
  });
});
