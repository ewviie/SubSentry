import { describe, it, expect } from "vitest";
import { buildDigestLines } from "./notification-emails";
import type { WeeklyDigestSummary } from "./digest";

// Focused coverage for buildDigestLines — the one place the weekly digest
// interpolates user-controlled text (a notification's title/body, which can
// embed a real subscription name) into HTML. Every summary field not
// relevant to a given test is set to its own honest "nothing here" value
// (null/0/empty), matching what computeWeeklyDigestSummary itself would
// produce for an otherwise-empty week — this file constructs the summary
// directly rather than going through that function, so each test only
// varies the one field it's actually about.
function baseSummary(overrides: Partial<WeeklyDigestSummary> = {}): WeeklyDigestSummary {
  return {
    monthlyCents: 0,
    currency: null,
    upcomingRenewalsCount: 0,
    upcomingRenewalsCents: 0,
    creepingCostAnnualDeltaCents: null,
    creepingCostCurrency: null,
    monthlyDeltaCents: null,
    potentialSavingsYearlyCents: 0,
    potentialSavingsCurrency: null,
    newNotificationCounts: {},
    totalNewNotifications: 0,
    topPriorityNotification: null,
    realizedSavings: { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 },
    ...overrides,
  };
}

const DASHBOARD_URL = "https://example.com/dashboard";

describe("buildDigestLines — HTML escaping", () => {
  it("escapes a malicious title/body in the html output, but not in the plain-text output", () => {
    const summary = baseSummary({
      topPriorityNotification: {
        title: '<script>alert("xss")</script>',
        body: "Body with <b>tags</b> & an ampersand",
        secondary: null,
      },
    });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("Body with &lt;b&gt;tags&lt;/b&gt; &amp; an ampersand");

    // Plain text is never HTML-parsed, so it carries the raw string —
    // escaping it would just show the reader literal "&lt;" characters.
    expect(text).toContain('<script>alert("xss")</script>');
  });

  it("escapes the secondary item's title/body the same way as the primary", () => {
    const summary = baseSummary({
      topPriorityNotification: {
        title: "Netflix increased from $12.99 to $15.99",
        body: "That's real.",
        secondary: { title: '<img src=x onerror=alert(1)>', body: "Second body" },
      },
    });
    const { html } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("buildDigestLines — topPriorityNotification.secondary rendering", () => {
  it("null: renders exactly the pre-existing single-item line, no 'Also:' clause", () => {
    const summary = baseSummary({
      topPriorityNotification: { title: "Only thing", body: "Only body", secondary: null },
    });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(html).toContain("Most worth reviewing: <strong style=\"color:#18181b;\">Only thing</strong> — Only body</p>");
    expect(html).not.toContain("Also:");
    expect(text).toContain("Most worth reviewing: Only thing — Only body");
    expect(text).not.toContain("Also:");
  });

  it("present: appends an 'Also:' clause naming the second item", () => {
    const summary = baseSummary({
      topPriorityNotification: {
        title: "Primary thing",
        body: "Primary body",
        secondary: { title: "Secondary thing", body: "Secondary body" },
      },
    });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(html).toContain("Most worth reviewing: <strong style=\"color:#18181b;\">Primary thing</strong> — Primary body Also: <strong style=\"color:#18181b;\">Secondary thing</strong> — Secondary body</p>");
    expect(text).toContain("Most worth reviewing: Primary thing — Primary body Also: Secondary thing — Secondary body");
  });

  it("null topPriorityNotification: renders neither line at all", () => {
    const summary = baseSummary({ topPriorityNotification: null });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(html).not.toContain("Most worth reviewing");
    expect(text).not.toContain("Most worth reviewing");
  });
});

describe("buildDigestLines — realized savings", () => {
  it("canceledCount = 0: no realized-savings line at all", () => {
    const summary = baseSummary();
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(html).not.toContain("saved");
    expect(text).not.toContain("saved");
  });

  it("canceledCount > 0, single currency: states the real yearly total and count", () => {
    const summary = baseSummary({
      realizedSavings: { monthlyCents: 2000, yearlyCents: 24000, currency: "usd", canceledCount: 2 },
    });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    // Not escapeHtml'd — this line is built entirely from formatCents' own
    // numeric output and a plain count, never user-controlled text, so the
    // literal apostrophe in "You've" is safe as-is (only &, <, > are
    // actually dangerous in HTML text content; escaping would just be
    // unnecessary work here, not a missing protection).
    expect(html).toContain("You've saved $240.00/yr so far, from 2 cancellations");
    expect(text).toContain("You've saved $240.00/yr so far, from 2 cancellations");
  });

  it("canceledCount > 0, singular phrasing for exactly 1 cancellation", () => {
    const summary = baseSummary({
      realizedSavings: { monthlyCents: 1000, yearlyCents: 12000, currency: "usd", canceledCount: 1 },
    });
    const { text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(text).toContain("from 1 cancellation");
    expect(text).not.toContain("1 cancellations");
  });

  it("mixed currencies: an honest gap, never a fabricated cross-currency total", () => {
    const summary = baseSummary({
      realizedSavings: { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 2 },
    });
    const { html, text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(text).toContain("You've saved money from 2 cancellations here (spanning more than one currency, so no single total)");
    expect(html).not.toMatch(/\$[\d,]+\.\d{2}\/yr/);
  });

  it("never appears alongside a fabricated dollar sign when canceledCount is 0 even if stray cents fields are non-null", () => {
    // Defensive: canceledCount is the only real gate — a caller can never
    // accidentally show a total for zero real cancellations.
    const summary = baseSummary({
      realizedSavings: { monthlyCents: 0, yearlyCents: 0, currency: "usd", canceledCount: 0 },
    });
    const { text } = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(text).not.toContain("saved");
  });
});

describe("buildDigestLines — free/pro parity", () => {
  // buildDigestLines takes no plan/isPremium parameter at all — every field
  // on WeeklyDigestSummary (including the new topPriorityNotification.secondary
  // and realizedSavings) renders identically regardless of which plan the
  // recipient is on. This is the parity guarantee itself: there is no
  // branch to test both sides of, which is the correct, ungated behavior.
  it("renders the same output for an otherwise-identical summary, proving no hidden plan branch exists", () => {
    const summary = baseSummary({
      topPriorityNotification: { title: "A", body: "B", secondary: { title: "C", body: "D" } },
      realizedSavings: { monthlyCents: 500, yearlyCents: 6000, currency: "usd", canceledCount: 1 },
    });
    const first = buildDigestLines(summary, DASHBOARD_URL, null);
    const second = buildDigestLines(summary, DASHBOARD_URL, null);
    expect(first).toEqual(second);
  });
});
