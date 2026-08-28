/**
 * New Tricks, from the browser: a guest session is one click, a community
 * trick is playable, and a finished play can be rated.
 *
 * Seeding (author + approve) goes through the API — the browser half under
 * test is playing, not moderating. Environments with no admin session skip.
 */
import { test, expect } from "@playwright/test";

import {
  apiAdminToken,
  forceJob,
  makeWallet,
  quizPayload,
  seedApprovedTrick,
  signInAsGuest,
  visit,
  weekIdOf,
  weeklyRolloverAt,
} from "./helpers";

test.describe("new tricks", () => {
  test("a guest plays a community trick, survives a reload, and rates it", async ({ page }) => {
    await visit(page, "/tricks");
    const trickId = await seedApprovedTrick(page);
    test.skip(!trickId, "this environment offers no admin session for seeding");

    await page.goto(`/tricks/${trickId}`);
    await signInAsGuest(page);

    // The guest session lives in the SDK, not the URL: a reload keeps both
    // the deep link and the identity.
    await page.reload();
    await expect(page).toHaveURL(`/tricks/${trickId}`);
    await expect(page.getByTestId("guest-badge")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /^play$/i }).click();
    for (let item = 0; item < 5; item += 1) {
      await page.getByRole("button", { name: "right", exact: true }).first().click();
    }

    // Five fast correct answers: the score lands and every row is a tick.
    await expect(page.getByText("trick complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("5 of 5 correct")).toBeVisible();
    await expect(page.getByText(/sign in with a wallet to earn GBP/i)).toBeVisible();

    // Rate it: five stars on both dimensions.
    await page.getByLabel("5 of 5").nth(0).click();
    await page.getByLabel("5 of 5").nth(1).click();
    await page.getByRole("button", { name: /^rate it$/i }).click();
    await expect(page.getByText(/your rating is in/i)).toBeVisible({ timeout: 15_000 });

    // A second attempt today is refused with the daily-cap message.
    await page.goto(`/tricks/${trickId}`);
    await expect(page.getByRole("button", { name: /played today/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a guest authors a quiz through the form and it lands pending", async ({ page }) => {
    await visit(page, "/tricks");
    await signInAsGuest(page);

    await page.getByRole("button", { name: /teach Buddy a trick/i }).click();
    const form = page.getByTestId("author-form");
    await expect(form).toBeVisible();

    // The form narrates what the API would refuse, before it is asked.
    await expect(form.getByText(/give it a title/i)).toBeVisible();
    await form.getByPlaceholder(/^title/).fill("E2E Authored Quiz");
    await form.getByPlaceholder(/payout address/).fill("not-an-address");
    await expect(form.getByText(/doesn't decode/i)).toBeVisible();
    await form.getByPlaceholder(/payout address/).fill(makeWallet().address);

    const items = form.locator("> .card");
    for (let index = 0; index < 5; index += 1) {
      const item = items.nth(index);
      await item.getByPlaceholder(`question ${index + 1}`).fill(`Question ${index + 1}?`);
      await item.getByPlaceholder(/^option 1/).fill("right");
      await item.getByPlaceholder(/^option 2/).fill("wrong");
    }

    const submit = form.getByRole("button", { name: /submit for review/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(/pending review/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("your tricks")).toBeVisible();
    await expect(page.getByText("E2E Authored Quiz")).toBeVisible();
  });

  /**
   * The whole loop, in one pass: author → approve → play → rate → weekly
   * rollover → featured on the shelf, creator on the prize snapshot. The
   * feature minimums are lowered for the pass and restored after — ten
   * distinct players is a community, not a smoke test.
   */
  test("@smoke the weekly cycle crowns a trick and books its creator's prize", async ({ page }) => {
    await visit(page, "/tricks");
    const adminToken = await apiAdminToken(page);
    test.skip(!adminToken, "this environment offers no admin session");

    const configBefore = await (
      await page.request.get("/api/admin/config", {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const restore = {
      tricksMinPlaysToFeature: configBefore.config.tricksMinPlaysToFeature,
      tricksMinRatersToFeature: configBefore.config.tricksMinRatersToFeature,
    };

    const payload = quizPayload(`Smoke Cycle ${Date.now()}`);
    try {
      await page.request.post("/api/admin/config", {
        headers: { authorization: `Bearer ${adminToken}` },
        data: { config: { tricksMinPlaysToFeature: 1, tricksMinRatersToFeature: 1 } },
      });

      const trickId = await seedApprovedTrick(page, payload);
      expect(trickId).toBeTruthy();

      await page.goto(`/tricks/${trickId}`);
      await signInAsGuest(page);
      await page.getByRole("button", { name: /^play$/i }).click();
      for (let item = 0; item < 5; item += 1) {
        await page.getByRole("button", { name: "right", exact: true }).first().click();
      }
      await expect(page.getByText("trick complete")).toBeVisible({ timeout: 30_000 });
      await page.getByLabel("5 of 5").nth(0).click();
      await page.getByLabel("5 of 5").nth(1).click();
      await page.getByRole("button", { name: /^rate it$/i }).click();
      await expect(page.getByText(/your rating is in/i)).toBeVisible({ timeout: 15_000 });

      const at = weeklyRolloverAt();
      const rolled = await forceJob(page, "force-weekly-rollover", undefined, at.toISOString());
      expect(rolled.ok()).toBeTruthy();

      // The seeded trick guarantees the shortlist is non-empty, but on a
      // shared environment another trick may legitimately out-rate it — so
      // the pick is pinned with the admin override, which also rewrites the
      // snapshot's winner row and its hash. Determinism and one more real
      // path, for the price of one call.
      const week = weekIdOf(at);
      const overridden = await page.request.post(`/api/admin/tricks/feature/${week}`, {
        headers: { authorization: `Bearer ${adminToken}` },
        data: { trickId },
      });
      expect(overridden.ok(), await overridden.text()).toBeTruthy();

      // The shelf crowns it for the opening week…
      await page.goto("/tricks");
      await expect(page.getByText("game of the week")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(payload.title)).toBeVisible();

      // …and the closing week's snapshot books the creator's reward.
      const cycle = weekIdOf(new Date(at.getTime() - 86400000));
      const snapshot = await (
        await page.request.get(`/api/admin/prize-cycle/${cycle}`, {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).json();
      const row = (snapshot.winners || []).find(
        (winner: any) => winner.game === "tricks" && winner.trickId === trickId,
      );
      expect(row, JSON.stringify(snapshot.winners)).toBeTruthy();
      expect(row.wallet).toBe(payload.payoutWallet);
      expect(row.prizeBuddy).toBeGreaterThan(0);
    } finally {
      await page.request.post("/api/admin/config", {
        headers: { authorization: `Bearer ${adminToken}` },
        data: { config: restore },
      });
    }
  });

  test("a malformed trick link falls back to the shelf", async ({ page }) => {
    // A bad id fails the param guard, and the first path segment still says
    // tricks — so the shelf, not the arcade, is where a dead link lands.
    await visit(page, "/tricks/not-a-real-id");
    await expect(page.getByRole("heading", { name: /new tricks/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
