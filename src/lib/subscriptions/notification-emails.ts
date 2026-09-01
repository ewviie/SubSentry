import { sendTransactionalEmail, appBaseUrl } from "@/lib/auth/email";
import { formatCents } from "./money";
import { escapeHtml } from "./renewal-reminders";
import type { PriceChangeCandidate } from "./price-history";
import type { WeeklyDigestSummary } from "./digest";

// Price-increase email — the one email in the Notification/Intelligence
// Center that fires at write-time (queries.ts's updateSubscription)
// instead of being generated lazily on a page load like every other
// notification type (see notifications/generate.ts's own header comment).
// It has to: a price increase is exactly the kind of thing that should
// reach an inbox the moment it's known, not whenever this user next opens
// the app. Same template shape (logo, one CTA button, unsubscribe-adjacent
// copy) as renewal-reminders.ts's own email — a second, inconsistent-
// looking email template for a sibling concept would read as a different
// product.
const EMERALD = "#007a49";
const SUPPORT_EMAIL = "support@subsentry.app";

function buildSubscriptionUrl(subscriptionId: string): string {
  return new URL(`/subscriptions/${subscriptionId}`, appBaseUrl()).toString();
}

function buildPriceIncreaseHtml(params: {
  name: string;
  fromLabel: string;
  toLabel: string;
  annualDeltaLabel: string;
  subscriptionUrl: string;
}): string {
  const logoUrl = new URL("/logo-mark.png", appBaseUrl()).toString();
  return `
<div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:40px 32px;">
    <img src="${logoUrl}" width="32" height="32" alt="SubSentry" style="display:block;border-radius:9999px;margin-bottom:24px;" />
    <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#18181b;">
      <strong>${escapeHtml(params.name)}</strong> went from <strong>${params.fromLabel}</strong> to <strong>${params.toLabel}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#71717a;">
      That's ${params.annualDeltaLabel} more per year than before. SubSentry only sends this once real price history
      shows a genuine change — never a guess.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${params.subscriptionUrl}" style="display:inline-block;background-color:${EMERALD};color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
        Review subscription
      </a>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
      Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMERALD};">Contact support</a>. Turn these off anytime
      in Settings → Notifications.
    </p>
  </div>
</div>`.trim();
}

function buildPriceIncreaseText(params: {
  name: string;
  fromLabel: string;
  toLabel: string;
  annualDeltaLabel: string;
  subscriptionUrl: string;
}): string {
  return [
    `${params.name} went from ${params.fromLabel} to ${params.toLabel}.`,
    `That's ${params.annualDeltaLabel} more per year than before. SubSentry only sends this once real price history shows a genuine change — never a guess.`,
    "",
    `Review subscription: ${params.subscriptionUrl}`,
    "",
    `Questions? Contact support (${SUPPORT_EMAIL}). Turn these off anytime in Settings -> Notifications.`,
  ].join("\n");
}

export async function sendPriceIncreaseEmail(params: {
  to: string;
  subscriptionId: string;
  name: string;
  fromCents: number;
  toCents: number;
  currency: string;
  change: PriceChangeCandidate;
}): Promise<void> {
  const subscriptionUrl = buildSubscriptionUrl(params.subscriptionId);
  const content = {
    name: params.name,
    fromLabel: formatCents(params.fromCents, params.currency),
    toLabel: formatCents(params.toCents, params.currency),
    annualDeltaLabel: formatCents(params.change.annualDeltaCents, params.currency),
    subscriptionUrl,
  };
  await sendTransactionalEmail(
    {
      to: params.to,
      subject: `${params.name} increased to ${content.toLabel}`,
      html: buildPriceIncreaseHtml(content),
      text: buildPriceIncreaseText(content),
    },
    "price-increase",
    subscriptionUrl,
  );
}

// "Your week with SubSentry" — see digest.ts's own header comment: every
// line here is a real, already-computed figure (WeeklyDigestSummary),
// never invented copy. A section is simply omitted when its own count is
// zero, rather than forced into the email with a manufactured "nothing to
// report here!" filler line — the brief's own "genuinely useful, not
// marketing spam" bar.
// Watchdog phase: priority order matches the product brief exactly — new
// discoveries first (price increases, then everything else new), then
// routine-but-useful context (upcoming renewals, creeping cost), then the
// one clear top action. Every line reads a real count/figure already on
// `summary`; nothing here invents copy for a zero count.
function buildDigestLines(summary: WeeklyDigestSummary, dashboardUrl: string): { html: string; text: string } {
  const rows: { html: string; text: string }[] = [];
  const counts = summary.newNotificationCounts;

  const priceIncreases = counts.price_increase ?? 0;
  if (priceIncreases > 0) {
    const line = `${priceIncreases} price increase${priceIncreases === 1 ? "" : "s"} found`;
    rows.push({ html: line, text: line });
  }

  if (summary.upcomingRenewalsCount > 0) {
    const n = summary.upcomingRenewalsCount;
    const line = `${n} renewal${n === 1 ? "" : "s"} coming up in the next 7 days`;
    rows.push({ html: line, text: line });
  }

  const savingsOpportunities = (counts.savings_opportunity ?? 0) + (counts.duplicate_subscription ?? 0);
  if (savingsOpportunities > 0) {
    const line = `${savingsOpportunities} new savings opportunit${savingsOpportunities === 1 ? "y" : "ies"} found`;
    rows.push({ html: line, text: line });
  }

  const unusualCharges = counts.unusual_charge ?? 0;
  if (unusualCharges > 0) {
    const line = `${unusualCharges} unusual charge${unusualCharges === 1 ? "" : "s"} flagged — worth a look`;
    rows.push({ html: `<strong>${line}</strong>`, text: line });
  }

  const lapsedRenewals = counts.renewal_lapsed ?? 0;
  if (lapsedRenewals > 0) {
    const line = `${lapsedRenewals} subscription${lapsedRenewals === 1 ? "" : "s"} may have lapsed — renewal date passed with no update`;
    rows.push({ html: line, text: line });
  }

  const staleSubscriptions = counts.stale_subscription ?? 0;
  if (staleSubscriptions > 0) {
    const line = `${staleSubscriptions} subscription${staleSubscriptions === 1 ? "" : "s"} you haven't reviewed in a while`;
    rows.push({ html: line, text: line });
  }

  if (summary.creepingCostAnnualDeltaCents !== null && summary.creepingCostCurrency) {
    const cost = formatCents(summary.creepingCostAnnualDeltaCents, summary.creepingCostCurrency);
    const line = `${cost}/yr in creeping cost from price increases over the last 12 months`;
    rows.push({ html: line, text: line });
  }

  if (summary.currency) {
    const spend = formatCents(summary.monthlyCents, summary.currency);
    rows.push({ html: `<strong>${spend}</strong>/mo in recurring spend, total`, text: `${spend}/mo in recurring spend, total` });
  }

  const htmlItems = rows.map((r) => `<li style="margin:0 0 8px;">${r.html}</li>`).join("");
  const textItems = rows.map((r) => `- ${r.text}`).join("\n");

  const topPriority = summary.topPriorityNotification
    ? {
        // escapeHtml on both — title/body are template strings built in
        // notifications/generate.ts that embed real subscription names
        // (free text, up to 120 chars — see subscriptionInputSchema), the
        // same "the one place this app interpolates user-controlled text
        // into HTML" risk renewal-reminders.ts's own escapeHtml exists for.
        html: `<p style="margin:16px 0 0;font-size:13px;color:#71717a;">Most worth reviewing: <strong style="color:#18181b;">${escapeHtml(summary.topPriorityNotification.title)}</strong> — ${escapeHtml(summary.topPriorityNotification.body)}</p>`,
        text: `\nMost worth reviewing: ${summary.topPriorityNotification.title} — ${summary.topPriorityNotification.body}`,
      }
    : { html: "", text: "" };

  const html = `
<div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:40px 32px;">
    <img src="${new URL("/logo-mark.png", appBaseUrl()).toString()}" width="32" height="32" alt="SubSentry" style="display:block;border-radius:9999px;margin-bottom:24px;" />
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#18181b;">Your week with SubSentry</p>
    <ul style="margin:0 0 8px;padding:0 0 0 18px;font-size:15px;line-height:1.5;color:#18181b;">${htmlItems}</ul>
    ${topPriority.html}
    <div style="text-align:center;margin:24px 0;">
      <a href="${dashboardUrl}" style="display:inline-block;background-color:${EMERALD};color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
        Open dashboard
      </a>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
      Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMERALD};">Contact support</a>. Turn this off anytime
      in Settings → Notifications.
    </p>
  </div>
</div>`.trim();

  const text = [
    "Your week with SubSentry",
    "",
    textItems,
    topPriority.text,
    "",
    `Open dashboard: ${dashboardUrl}`,
    "",
    `Questions? Contact support (${SUPPORT_EMAIL}). Turn this off anytime in Settings -> Notifications.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}

export async function sendWeeklyDigestEmail(to: string, summary: WeeklyDigestSummary): Promise<void> {
  const dashboardUrl = new URL("/dashboard", appBaseUrl()).toString();
  const { html, text } = buildDigestLines(summary, dashboardUrl);
  await sendTransactionalEmail(
    { to, subject: "Your week with SubSentry", html, text },
    "weekly-digest",
    dashboardUrl,
  );
}
