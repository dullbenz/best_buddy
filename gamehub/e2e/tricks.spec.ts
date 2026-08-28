/**
 * New Tricks, from the browser: a guest session is one click, a community
 * trick is playable, and a finished play can be rated.
 *
 * Seeding (author + approve) goes through the API — the browser half under
 * test is playing, not moderating. Environments with no admin session skip.
 */
import { test, expect } from "@playwright/test";

import { makeWallet, seedApprovedTrick, signInAsGuest, visit } from "./helpers";

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

  test("a malformed trick link falls back to the shelf", async ({ page }) => {
    // A bad id fails the param guard, and the first path segment still says
    // tricks — so the shelf, not the arcade, is where a dead link lands.
    await visit(page, "/tricks/not-a-real-id");
    await expect(page.getByRole("heading", { name: /new tricks/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
