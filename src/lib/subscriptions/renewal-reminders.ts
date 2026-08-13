import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { renewalReminders, subscriptions, users, type Subscription } from "@/lib/db/schema";
import { appBaseUrl, sendTransactionalEmail } from "@/lib/auth/email";
import { formatCents, monthlyCents } from "./money";
import { daysUntilRenewal, REMINDER_WINDOW_MIN_DAYS, REMINDER_WINDOW_MAX_DAYS } from "./filters";
import { BILLING_CYCLE_LABELS } from "./labels";
import { logServerError } from "@/lib/observability/log-error";

// The full renewal-reminder job: find subscriptions approaching renewal,
// claim each one exactly once (see claimReminder below for the concurrency
// story), send an email through the existing SMTP infra (lib/auth/email.ts),
// and record that it was sent. See renewal_reminders' own schema comment
// (lib/db/schema.ts) for the two-phase claimedAt/sentAt state this all
// hinges on.
//
// Timezone note: like every other renewal calculation in this app
// (filters.ts's daysUntilRenewal/isUpcomingRenewal), "today" here is the
// server's UTC clock compared against nextRenewalDate's UTC-midnight date
// value — there is no per-user timezone stored anywhere in this schema, so
// a user several hours off UTC can see a reminder land on what's still
// "yesterday" or already "tomorrow" their local time. That's an existing,
// pre-Phase-5 limitation of how dates are stored app-wide, not something
// this job invents or could fix on its own — see the Phase 5 report for
// the full callout.

// ── Copy & templates ────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// The one email template in this codebase that interpolates user-controlled
// text (subscription.name — free text, capped at 120 chars by
// subscriptionInputSchema but otherwise unrestricted) into HTML. Every
// other template in lib/auth/email.ts only ever interpolates
// server-generated strings (URLs built from validated tokens/ids), so no
// equivalent helper existed before this.
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

const renewalDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatRenewalDate(nextRenewalDate: string): string {
  return renewalDateFormatter.format(new Date(`${nextRenewalDate}T00:00:00Z`));
}

// "renews today" / "renews tomorrow" / "renews in N days" — never a
// hardcoded window size (see REMINDER_WINDOW_MIN_DAYS/MAX_DAYS's own
// comment in filters.ts on why): a late catch-up run still reads correctly
// because this always uses the real, current day count.
export function renewalReminderSubject(name: string, days: number): string {
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `${name} renews ${when}`;
}

interface ReminderContent {
  name: string;
  amountCents: number;
  currency: string;
  billingCycle: Subscription["billingCycle"];
  nextRenewalDate: string;
  subscriptionUrl: string;
  unsubscribeUrl: string | null;
}

// Optional monthly-equivalent context for a non-monthly plan (brief item:
// "optional annual/monthly context") — reuses monthlyCents (money.ts), the
// same conversion the dashboard's own totals already use, never a second
// division-by-12-or-3 written out here.
function cycleContext(amountCents: number, currency: string, billingCycle: Subscription["billingCycle"]): string {
  if (billingCycle === "monthly") return "Billed monthly.";
  const monthly = formatCents(monthlyCents(amountCents, billingCycle), currency);
  return `Billed ${BILLING_CYCLE_LABELS[billingCycle].toLowerCase()} — ${monthly}/mo equivalent.`;
}

const EMERALD = "#007a49"; // same converted-sRGB constant lib/auth/email.ts uses — email clients don't support oklch()
const SUPPORT_EMAIL = "support@subsentry.app";

function buildRenewalReminderHtml(content: ReminderContent): string {
  const logoUrl = new URL("/logo-mark.png", appBaseUrl()).toString();
  const amount = formatCents(content.amountCents, content.currency);
  const dateLabel = formatRenewalDate(content.nextRenewalDate);
  const name = escapeHtml(content.name);
  return `
<div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:40px 32px;">
    <img src="${logoUrl}" width="32" height="32" alt="SubSentry" style="display:block;border-radius:9999px;margin-bottom:24px;" />
    <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#18181b;">
      <strong>${name}</strong> renews on ${dateLabel} for <strong>${amount}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#71717a;">
      ${cycleContext(content.amountCents, content.currency, content.billingCycle)} SubSentry hasn't canceled or changed
      anything — this is just a heads-up before it renews.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${content.subscriptionUrl}" style="display:inline-block;background-color:${EMERALD};color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
        Review subscription
      </a>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
      Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMERALD};">Contact support</a>.
      ${content.unsubscribeUrl ? `<br /><a href="${content.unsubscribeUrl}" style="color:${EMERALD};">Turn off renewal reminders</a>.` : ""}
    </p>
  </div>
</div>`.trim();
}

function buildRenewalReminderText(content: ReminderContent): string {
  const amount = formatCents(content.amountCents, content.currency);
  const dateLabel = formatRenewalDate(content.nextRenewalDate);
  const lines = [
    `${content.name} renews on ${dateLabel} for ${amount}.`,
    cycleContext(content.amountCents, content.currency, content.billingCycle) +
      " SubSentry hasn't canceled or changed anything — this is just a heads-up before it renews.",
    "",
    `Review subscription: ${content.subscriptionUrl}`,
    "",
    `Questions? Contact support (${SUPPORT_EMAIL}).`,
  ];
  if (content.unsubscribeUrl) {
    lines.push(`Turn off renewal reminders: ${content.unsubscribeUrl}`);
  }
  return lines.join("\n");
}

export function buildSubscriptionUrl(subscriptionId: string): string {
  return new URL(`/subscriptions/${subscriptionId}`, appBaseUrl()).toString();
}

export async function sendRenewalReminderEmail(params: {
  to: string;
  name: string;
  amountCents: number;
  currency: string;
  billingCycle: Subscription["billingCycle"];
  nextRenewalDate: string;
  subscriptionId: string;
  unsubscribeUrl: string | null;
}): Promise<void> {
  const days = daysUntilRenewal({ nextRenewalDate: params.nextRenewalDate });
  const content: ReminderContent = {
    name: params.name,
    amountCents: params.amountCents,
    currency: params.currency,
    billingCycle: params.billingCycle,
    nextRenewalDate: params.nextRenewalDate,
    subscriptionUrl: buildSubscriptionUrl(params.subscriptionId),
    unsubscribeUrl: params.unsubscribeUrl,
  };
  await sendTransactionalEmail(
    {
      to: params.to,
      subject: renewalReminderSubject(params.name, days),
      html: buildRenewalReminderHtml(content),
      text: buildRenewalReminderText(content),
    },
    "renewal-reminder",
    content.subscriptionUrl,
  );
}

// ── Unsubscribe token (stateless, HMAC-signed) ──────────────────────────
//
// Reuses CRON_SECRET as the root key rather than adding a second env var
// for a one-off feature — but never uses CRON_SECRET directly as an HMAC
// key. `deriveKey` runs it through one extra HMAC step keyed by a purpose
// label first, so this token's key material is cryptographically
// independent of the raw cron bearer-token secret: a leak of one doesn't
// hand out the other. No expiry — an unsubscribe link staying valid
// indefinitely is the point (it must always work, "obvious/easy way to
// disable"), and the only thing it can ever do is flip one boolean off.

function deriveKey(purpose: string): Buffer | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(purpose).digest();
}

export function isRenewalReminderJobConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET);
}

export function buildUnsubscribeToken(userId: string): string | null {
  const key = deriveKey("unsubscribe");
  if (!key) return null;
  return createHmac("sha256", key).update(userId).digest("hex");
}

// Length-then-timingSafeEqual — the same guarded pattern
// lib/billing/stripe-webhook.ts's verifyStripeSignature uses, for the same
// reason: timingSafeEqual throws on mismatched-length buffers, and a
// malformed/short token from an attacker is exactly the input that would
// trigger that.
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = buildUnsubscribeToken(userId);
  if (!expected) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(token, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function buildUnsubscribeUrl(userId: string): string | null {
  const token = buildUnsubscribeToken(userId);
  if (!token) return null;
  const url = new URL("/api/renewal-reminders/unsubscribe", appBaseUrl());
  url.searchParams.set("u", userId);
  url.searchParams.set("t", token);
  return url.toString();
}

// ── Cron auth ────────────────────────────────────────────────────────────
//
// Same length-then-timingSafeEqual shape as verifyUnsubscribeToken above —
// deliberately not sharing one generic helper for both, since a bearer
// token compares a raw secret and an unsubscribe token compares hex-decoded
// HMAC output; conflating the two encodings for the sake of one fewer
// function is the kind of "unnecessary abstraction" the brief explicitly
// warned against.
export function verifyCronAuth(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorizationHeader) return false;
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (!match) return false;
  const expectedBuffer = Buffer.from(secret);
  const actualBuffer = Buffer.from(match[1]);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

// ── Candidate query ──────────────────────────────────────────────────────

// A window, not an exact match — see REMINDER_WINDOW_MIN_DAYS/MAX_DAYS's
// own comment (filters.ts) for why. Capped per run (not "every due
// subscription in the world in one query") so one job invocation has a
// bounded worst case regardless of how large this table ever grows;
// a run that hits the cap leaves the remainder for the next scheduled run,
// same as any other batch-processing job in this app.
const MAX_CANDIDATES_PER_RUN = 500;

// How long a claim is allowed to sit with sentAt still null before a later
// run treats it as abandoned (crashed process, killed deployment mid-send)
// and safely retries it — see renewal_reminders' own schema comment and
// claimReminder below for the full reclaim mechanics. Comfortably longer
// than any single SMTP attempt (including its own internal retries —
// MAX_SEND_ATTEMPTS * RETRY_DELAY_MS in lib/auth/email.ts is on the order
// of a second, not minutes) so a claim still legitimately in flight is
// never mistaken for abandoned by a concurrent or immediately-following run.
const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface ReminderCandidate {
  subscriptionId: string;
  userId: string;
  userEmail: string;
  name: string;
  amountCents: number;
  currency: string;
  billingCycle: Subscription["billingCycle"];
  nextRenewalDate: string;
}

function addDaysUtcIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// Explicit column list, not select(subscriptions)/select(users) — this
// query already joins three tables; returning every column of each (including
// ones this job never reads, like notes or passwordHash-adjacent user
// fields) would be exactly the unnecessary-SELECT* the brief called out.
// renewalRemindersEnabled/emailVerified are filtered on but not returned —
// they're already true for every row that passes the WHERE clause.
export async function findReminderCandidates(now: Date = new Date()): Promise<ReminderCandidate[]> {
  const minDate = addDaysUtcIso(REMINDER_WINDOW_MIN_DAYS);
  const maxDate = addDaysUtcIso(REMINDER_WINDOW_MAX_DAYS);
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      userId: subscriptions.userId,
      userEmail: users.email,
      name: subscriptions.name,
      amountCents: subscriptions.amountCents,
      currency: subscriptions.currency,
      billingCycle: subscriptions.billingCycle,
      nextRenewalDate: subscriptions.nextRenewalDate,
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(
      renewalReminders,
      and(eq(renewalReminders.subscriptionId, subscriptions.id), eq(renewalReminders.renewalDate, subscriptions.nextRenewalDate)),
    )
    .where(
      and(
        eq(subscriptions.status, "active"),
        gte(subscriptions.nextRenewalDate, minDate),
        lte(subscriptions.nextRenewalDate, maxDate),
        eq(users.renewalRemindersEnabled, true),
        eq(users.emailVerified, true),
        // No reminder row yet for this exact (subscriptionId, renewalDate)
        // event, OR one exists but never got sent and its claim is stale —
        // anything else (already sent, or claimed recently by a
        // still-in-flight run) is excluded here rather than filtered after
        // the fact, so a run's own query never even looks at work another
        // run already owns or finished.
        or(
          isNull(renewalReminders.id),
          and(isNull(renewalReminders.sentAt), lt(renewalReminders.claimedAt, staleThreshold)),
        ),
      ),
    )
    .orderBy(asc(subscriptions.nextRenewalDate))
    .limit(MAX_CANDIDATES_PER_RUN);

  return rows;
}

// ── Claim / send / mark-sent ─────────────────────────────────────────────

// Two-phase, not "insert then send then update" as one hopeful sequence:
// - Try a fresh insert first. Postgres' unique index on
//   (subscriptionId, renewalDate) means at most one concurrent caller ever
//   wins this for a given renewal event.
// - If that lands zero rows (either genuinely already claimed by a
//   still-in-flight run, or previously claimed-and-abandoned), attempt a
//   conditional UPDATE that only succeeds if the existing row is both
//   unsent AND stale. This is the reclaim path — it's what makes retrying
//   after a crash/restart safe without a second, competing insert path.
// Returns the reminder row's id to send under, or null if this run should
// not send (someone else currently owns it, or it's already sent).
async function claimReminder(candidate: ReminderCandidate, now: Date): Promise<string | null> {
  const inserted = await db
    .insert(renewalReminders)
    .values({
      userId: candidate.userId,
      subscriptionId: candidate.subscriptionId,
      renewalDate: candidate.nextRenewalDate,
      claimedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: renewalReminders.id });
  if (inserted[0]) return inserted[0].id;

  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);
  const reclaimed = await db
    .update(renewalReminders)
    .set({ claimedAt: now })
    .where(
      and(
        eq(renewalReminders.subscriptionId, candidate.subscriptionId),
        eq(renewalReminders.renewalDate, candidate.nextRenewalDate),
        isNull(renewalReminders.sentAt),
        lt(renewalReminders.claimedAt, staleThreshold),
      ),
    )
    .returning({ id: renewalReminders.id });
  return reclaimed[0]?.id ?? null;
}

async function markReminderSent(reminderId: string, sentAt: Date): Promise<void> {
  await db.update(renewalReminders).set({ sentAt }).where(eq(renewalReminders.id, reminderId));
}

// Per-run cap on how many emails this one invocation will actually attempt
// to send — independent of MAX_CANDIDATES_PER_RUN (the query limit) and the
// scheduling cadence. The recipient is always the subscription's own
// owning user (see the ownership note on runRenewalReminderJob below), so
// this isn't a defense against spoofed recipients — it bounds the worst
// case outbound SMTP volume from a single run regardless of how many
// subscriptions across how many accounts happen to be simultaneously due,
// including a pathological case like one account (or a burst of scripted
// signups — signup has no email-ownership verification today, see
// users.emailVerified's own schema comment) accumulating an unrealistic
// number of due subscriptions at once. Candidates past the cap are simply
// left for the next scheduled run, same as MAX_CANDIDATES_PER_RUN's own
// overflow handling.
//
// Counted against attempts (sent + failed), not sent alone — an SMTP
// outage where every candidate fails must still stop this run at the cap
// instead of ploughing through all MAX_CANDIDATES_PER_RUN candidates (each
// with its own internal retry — see lib/auth/email.ts) with a
// never-incrementing counter.
const MAX_EMAILS_PER_RUN = 200;

export interface RenewalReminderJobResult {
  candidates: number;
  claimed: number;
  sent: number;
  failed: number;
  skippedCap: number;
}

// The orchestration: query, then for each candidate try to claim it, and
// only if claimed, actually send. Ownership is implicit and airtight by
// construction — the recipient is always users.email joined on
// subscriptions.userId (see findReminderCandidates), never anything
// caller-supplied, so there is no code path here that could email the
// wrong account's address for a given subscription.
//
// sentAt is set ONLY after sendRenewalReminderEmail resolves successfully
// (see the try/catch below) — a failed send leaves the row claimed but
// unsent, exactly the state claimReminder's reclaim condition is built to
// retry on the next run. No retry loop *within* this run (a failure just
// moves on to the next candidate) — that's what keeps this from becoming
// an unbounded retry loop; the retry happens on the job's next scheduled
// invocation instead, bounded by STALE_CLAIM_MS.
export async function runRenewalReminderJob(now: Date = new Date()): Promise<RenewalReminderJobResult> {
  const candidates = await findReminderCandidates(now);
  const result: RenewalReminderJobResult = { candidates: candidates.length, claimed: 0, sent: 0, failed: 0, skippedCap: 0 };

  for (const candidate of candidates) {
    if (result.sent + result.failed >= MAX_EMAILS_PER_RUN) {
      result.skippedCap++;
      continue;
    }

    const reminderId = await claimReminder(candidate, now);
    if (!reminderId) continue; // already owned/sent by someone else
    result.claimed++;

    try {
      await sendRenewalReminderEmail({
        to: candidate.userEmail,
        name: candidate.name,
        amountCents: candidate.amountCents,
        currency: candidate.currency,
        billingCycle: candidate.billingCycle,
        nextRenewalDate: candidate.nextRenewalDate,
        subscriptionId: candidate.subscriptionId,
        unsubscribeUrl: buildUnsubscribeUrl(candidate.userId),
      });
      await markReminderSent(reminderId, new Date());
      result.sent++;
    } catch (error) {
      result.failed++;
      logServerError("subscriptions.renewal-reminders.send-failed", error, {
        subscriptionId: candidate.subscriptionId,
        reminderId,
      });
      // Deliberately not re-throwing — one failed send must not abort the
      // rest of this run's candidates. The row stays claimed-but-unsent
      // and is picked up again once STALE_CLAIM_MS has passed.
    }
  }

  // skippedCap is surfaced to the caller (the cron route's own JSON
  // response — aggregate counts only) rather than logged as a security
  // event here: hitting the per-run cap isn't itself suspicious, it's an
  // expected outcome of a bounded run, and the candidates it left behind
  // are picked up by the next scheduled invocation.
  return result;
}
