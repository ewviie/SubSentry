import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// The DemoProvider (lib/ai/demo-provider.ts, used automatically wherever
// ANTHROPIC_API_KEY isn't set — this suite always runs that way) never
// itself finds a renewal date in plain text (see its own comment on why —
// same "don't guess a date" posture parse-subscription.ts documents), so
// every row this suite parses lands in the review table needing one set
// via Edit before it counts toward the confirm batch (see
// bulk-quick-add-review-table.tsx's own "Needs a date" comment) — the
// bulk-flow equivalent of the single quick-add dialog's own required date
// input. This helper does that one real interaction per row a genuine
// demo-mode user would also have to do.
async function setRenewalDate(page: Page, name: string, date: string) {
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  await expect(page.getByText("Edit detected subscription")).toBeVisible();
  await page.getByLabel("Next renewal").fill(date);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Edit detected subscription")).not.toBeVisible();
}

// User Value Journey Audit, opportunity #1: bulk quick-add. Covers the
// complete paste -> review (edit/remove) -> confirm flow through the real
// UI.
test.describe("Bulk quick-add", () => {
  test("pastes a list, reviews it, and adds every row on confirm", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-happy");

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await expect(user.page.getByText("Add multiple subscriptions")).toBeVisible();

    await user.page
      .getByLabel("Paste a list of subscriptions, one per line")
      .fill("Netflix $15.99/mo\nSpotify $9.99/mo\nHulu $2.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();

    await expect(user.page.getByText("Review before adding")).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "Spotify", exact: true })).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "Hulu", exact: true })).toBeVisible();
    // Nothing is confirmable yet — every row needs a date first.
    await expect(user.page.getByRole("button", { name: "Add 0 subscriptions" })).toBeDisabled();

    for (const name of ["Netflix", "Spotify", "Hulu"]) {
      await setRenewalDate(user.page, name, "2099-01-01");
    }

    await expect(user.page.getByRole("button", { name: "Add 3 subscriptions" })).toBeVisible();
    await user.page.getByRole("button", { name: "Add 3 subscriptions" }).click();
    await expect(user.page.getByText("3 subscriptions added")).toBeVisible();
    // Dialog closes on success.
    await expect(user.page.getByText("Review before adding")).not.toBeVisible();

    await user.page.goto("/subscriptions");
    await expect(user.page.getByText("Netflix").last()).toBeVisible();
    await expect(user.page.getByText("Spotify").last()).toBeVisible();
    await expect(user.page.getByText("Hulu").last()).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("lets you edit a row before confirming, and the edit — not the original parse — is what gets saved", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-edit");

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await user.page.getByLabel("Paste a list of subscriptions, one per line").fill("Netflix $15.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();

    await user.page.getByRole("button", { name: "Edit Netflix" }).click();
    await expect(user.page.getByText("Edit detected subscription")).toBeVisible();
    await user.page.getByLabel("Name").fill("Netflix Premium");
    await user.page.getByLabel("Amount").fill("22.99");
    await user.page.getByLabel("Next renewal").fill("2099-01-01");
    await user.page.getByRole("button", { name: "Save" }).click();

    // The review table now reflects the edit, not the original parse.
    await expect(user.page.getByRole("cell", { name: "Netflix Premium", exact: true })).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "$22.99" })).toBeVisible();

    await user.page.getByRole("button", { name: "Add 1 subscription" }).click();
    await expect(user.page.getByText("1 subscription added")).toBeVisible();

    await user.page.goto("/subscriptions");
    await expect(user.page.getByText("Netflix Premium").last()).toBeVisible();
    await expect(user.page.getByText("Netflix", { exact: true })).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("lets you remove a row before confirming, and only the remaining rows are added", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-remove");

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await user.page.getByLabel("Paste a list of subscriptions, one per line").fill("Netflix $15.99/mo\nSpotify $9.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();

    await user.page.getByRole("button", { name: "Remove Spotify" }).click();
    await expect(user.page.getByRole("cell", { name: "Spotify", exact: true })).not.toBeVisible();

    await setRenewalDate(user.page, "Netflix", "2099-01-01");
    await expect(user.page.getByRole("button", { name: "Add 1 subscription" })).toBeVisible();
    await user.page.getByRole("button", { name: "Add 1 subscription" }).click();
    await expect(user.page.getByText("1 subscription added")).toBeVisible();

    await user.page.goto("/subscriptions");
    await expect(user.page.getByText("Netflix").last()).toBeVisible();
    await expect(user.page.getByText("Spotify")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Every real line the DemoProvider is asked to parse succeeds with
  // *something* (see demo-provider.ts's own comment — it never itself
  // returns ok:false), so the honest, deterministically-reachable
  // "malformed line" case in this environment is one this app's own
  // quick-add line schema rejects before the parser is ever called (too
  // short — see quickAddLineSchema, parse-subscription.ts) — surfaced
  // plainly, not silently dropped and not guessed at.
  test("surfaces a line it can't accept honestly, without silently dropping it or guessing", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-malformed");

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await user.page.getByLabel("Paste a list of subscriptions, one per line").fill("Netflix $15.99/mo\nhi\nSpotify $9.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();

    await expect(user.page.getByText("1 line couldn't be understood")).toBeVisible();
    // The exact curly-quoted raw line the review screen renders (see
    // bulk-quick-add-review-table.tsx's &ldquo;/&rdquo;) — a bare "hi"
    // substring match would also match unrelated text like "This" on the
    // same page, so this checks the quoted form specifically.
    await expect(user.page.getByText("“hi”")).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();
    await expect(user.page.getByRole("cell", { name: "Spotify", exact: true })).toBeVisible();
    // Only the 2 real lines ever became rows at all — the malformed one
    // never got a draft to edit or confirm in the first place.
    await expect(user.page.getByText(/2 need a renewal date first/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("nothing is saved if the dialog is closed before confirming", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-cancel");

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await user.page.getByLabel("Paste a list of subscriptions, one per line").fill("Netflix $15.99/mo\nSpotify $9.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();

    await user.page.keyboard.press("Escape");
    await expect(user.page.getByText("Review before adding")).not.toBeVisible();

    await user.page.goto("/subscriptions");
    await expect(user.page.getByText("Netflix")).not.toBeVisible();
    await expect(user.page.getByText("Spotify")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("mobile viewport: the full paste -> review -> edit -> confirm flow works with no horizontal overflow", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-bulk-add-mobile", { viewport: { width: 375, height: 667 } });

    await user.page.goto("/dashboard");
    await user.page.getByRole("button", { name: "Add multiple at once" }).click();
    await user.page.getByLabel("Paste a list of subscriptions, one per line").fill("Netflix $15.99/mo\nSpotify $9.99/mo");
    await user.page.getByRole("button", { name: "Parse list" }).click();
    await expect(user.page.getByRole("cell", { name: "Netflix", exact: true })).toBeVisible();

    const reviewOverflow = await user.page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(reviewOverflow.scrollWidth, "bulk quick-add review table must not scroll the page horizontally on mobile").toBeLessThanOrEqual(
      reviewOverflow.innerWidth,
    );

    await setRenewalDate(user.page, "Netflix", "2099-01-01");
    const editOverflow = await user.page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(editOverflow.scrollWidth, "the row-edit dialog must not scroll the page horizontally on mobile").toBeLessThanOrEqual(
      editOverflow.innerWidth,
    );

    await setRenewalDate(user.page, "Spotify", "2099-01-01");
    await user.page.getByRole("button", { name: /Add 2 subscriptions/ }).click();
    await expect(user.page.getByText("2 subscriptions added")).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
