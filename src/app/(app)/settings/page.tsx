import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { isAIConfigured } from "@/lib/ai/provider";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl, isBillingPortalConfigured, isBetaAllAccess } from "@/lib/billing/plan";
import { PRO_MONTHLY_PRICE, PRO_FEATURES } from "@/lib/billing/pro-features";
import { getDevPlanPreview, resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { initials } from "@/lib/utils";
import { getEmailConnection } from "@/lib/imports/email-connections";
import { listBankConnections } from "@/lib/imports/bank-connections";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EditNameForm } from "@/components/settings/edit-name-form";
import { RenewalReminderToggle } from "@/components/settings/renewal-reminder-toggle";
import { RenewalLeadDaysSelect } from "@/components/settings/renewal-lead-days-select";
import { NotificationPreferenceToggle } from "@/components/settings/notification-preference-toggle";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { ConnectedAccountRow } from "@/components/settings/connected-account-row";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";

// PRO_FEATURES (lib/billing/pro-features.ts) is the single shared list
// pricing-section.tsx and the login page's Pro teaser also read from — see
// that file's own comment. Used to be a locally-hardcoded array here, which
// is exactly how this list once drifted out of sync with pricing-section.tsx
// (missing "Optimization recommendations" until that was caught
// separately). No "Everything in Free" line: it's redundant here, since
// this card only ever shows for a free-plan account in the first place.

export default async function SettingsPage() {
  const user = await requireUser();
  const isPaid = await resolveHasPaidAccess(user.plan);
  const activeCount = isPaid ? 0 : (await listSubscriptions(user.id)).filter((s) => s.status === "active").length;
  const upgradeUrl = isPaid ? null : getUpgradeUrl(user.id);
  const aiConfigured = isAIConfigured();
  const portalConfigured = isBillingPortalConfigured();
  // A dev preview overrides user.plan (see getSession()'s own comment) so
  // isPaid above already reflects it correctly — but isBetaAllAccess()
  // itself has no way to know that, since it isn't session-scoped. Without
  // this, previewing "Free" while the real beta is still on would still
  // show the "Beta: full access" badge below, which would be actively
  // false during the preview it exists to demonstrate.
  const beta = isBetaAllAccess() && !(await getDevPlanPreview());

  // Self-service disconnect surface for every live-API import connection.
  // see api/imports/{gmail,plaid,truelayer}/disconnect. Fetched here
  // (Server Component) rather than client-side so a disconnect's
  // router.refresh() (see ConnectedAccountRow) re-derives this from the
  // database instead of trusting client-side state to stay in sync with it.
  const [emailConnection, bankConnections] = await Promise.all([
    getEmailConnection(user.id, "gmail"),
    listBankConnections(user.id),
  ]);
  const plaidConnections = bankConnections.filter((c) => c.provider === "plaid");
  const truelayerConnections = bankConnections.filter((c) => c.provider === "truelayer");
  const hasConnectedAccounts = Boolean(emailConnection) || plaidConnections.length > 0 || truelayerConnections.length > 0;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback className="bg-emerald-muted text-base font-semibold text-emerald">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
        {/* UI audit fix: a name-less account used to render its email
            address here as this page's text-h1 hero headline — the email
            is already shown, properly labeled, in the Email row below;
            repeating it unlabeled and oversized as if it were a name
            wasn't a considered fallback, it was displaying the wrong
            field at the wrong size. "Your account" is a neutral heading
            for that case, same register as the page's own description
            line right underneath it. min-w-0 + break-words stay: a
            user-entered name has no natural break point either (up to
            120 chars — see EditNameForm) and could still force this row
            wider than the viewport without them. */}
        <div className="min-w-0">
          <h1 className="break-words font-heading text-h1 font-semibold">{user.name || "Your account"}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your account, plan, and AI configuration.
          </p>
        </div>
      </div>

      <StaggerSection className="mt-6 space-y-5" staggerChildren={0.06}>
        <MotionCard>
          <Card className="shadow-elevation-low">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Your account details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <EditNameForm initialName={user.name ?? ""} />
              {/* min-w-0 on the row + truncate on the value: same fix as
                  this page's own header (see the h1 above), applied here
                  too. An email has no natural break point, and this row
                  had nothing stopping a long one from forcing the whole
                  row (and the page) wider than a phone screen. */}
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="shrink-0 text-muted-foreground">Email</span>
                <span className="truncate" title={user.email}>{user.email}</span>
              </div>
            </CardContent>
          </Card>
        </MotionCard>

        {/* Product-value pass: this used to be one checkbox folded into the
            Account card above ("a whole card's worth of chrome for one line
            of content"). It's genuinely four independent controls now
            (renewal reminders + their lead time, price-alert emails, the
            weekly digest) — enough to earn its own card the same way Plan &
            billing already has one, rather than keep stretching Account's
            own rationale past the point it was actually true. */}
        <MotionCard>
          <Card className="shadow-elevation-low">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>What SubSentry emails you about, and how far ahead.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <RenewalReminderToggle initialEnabled={user.renewalRemindersEnabled} />
              <RenewalLeadDaysSelect initialValue={user.renewalReminderLeadDays} />
            </CardContent>
            <CardContent className="space-y-4 border-t border-border pt-4 text-sm">
              <NotificationPreferenceToggle
                field="priceAlertEmailsEnabled"
                label="Price increase emails"
                description="Get an email when a tracked subscription's price genuinely goes up."
                initialEnabled={user.priceAlertEmailsEnabled}
              />
              <NotificationPreferenceToggle
                field="weeklyDigestEnabled"
                label="Weekly digest"
                description="A short weekly summary: spend, renewals, price changes, and savings found."
                initialEnabled={user.weeklyDigestEnabled}
              />
            </CardContent>
          </Card>
        </MotionCard>

        <MotionCard>
          <Card highlight={isPaid} className={isPaid ? undefined : "shadow-elevation-low"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Plan &amp; billing
                <Badge className={isPaid ? "bg-emerald text-emerald-foreground" : undefined} variant={isPaid ? undefined : "secondary"}>
                  {beta ? "Beta: full access" : user.plan === "pro" ? "Pro" : "Free"}
                </Badge>
              </CardTitle>
              <CardDescription>
                {/* Section 12 of the monetization pass: this relationship
                    needs to be obvious without being obnoxious, specifically
                    including this exact sentence during the beta — the
                    badge above already says "Beta: full access", but that's
                    a two-word status, not the actual sentence a user should
                    be able to read and understand their situation from. */}
                {beta
                  ? "You have unlimited subscriptions. You're currently receiving Pro access free during the beta — no card required."
                  : isPaid
                    ? "You have unlimited subscriptions."
                    : `Up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions.`}
              </CardDescription>
            </CardHeader>
            {user.plan === "pro" && portalConfigured && user.stripeCustomerId ? (
              <CardContent>
                <ManageBillingButton />
              </CardContent>
            ) : null}
            {!isPaid ? (
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Active subscriptions</span>
                    <span className="font-mono tabular-nums">
                      {activeCount} / {FREE_PLAN_SUBSCRIPTION_LIMIT}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald"
                      style={{
                        width: `${Math.min((activeCount / FREE_PLAN_SUBSCRIPTION_LIMIT) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
                {/* Shown even when upgradeUrl is null (no live payment
                    link configured yet — see getUpgradeUrl) rather than
                    hiding this whole block: billing/upgrade-prompt.tsx's
                    shared components establish the same pattern everywhere
                    else a gate renders — still naming what Pro unlocks with
                    plain text when there's nothing to link to yet. A user
                    who's just hit their 5-subscription cap is exactly who
                    should see what upgrading gets them, even before
                    there's a working checkout to send them to; a real CTA
                    button only ever appears once one exists. */}
                <div className="rounded-lg border border-emerald/20 bg-emerald-muted/40 p-4">
                  <p className="text-sm font-medium">Upgrade to Pro: {PRO_MONTHLY_PRICE}/mo</p>
                  <ul className="mt-2 space-y-1.5">
                    {PRO_FEATURES.map((benefit) => (
                      <li key={benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="size-3.5 shrink-0 text-emerald" aria-hidden="true" />
                        {benefit}
                      </li>
                    ))}
                  </ul>
                  {upgradeUrl ? (
                    <Button className="mt-3" render={<a href={upgradeUrl} />} nativeButton={false}>
                      Upgrade to Pro
                    </Button>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">Upgrades aren&apos;t open yet — check back soon.</p>
                  )}
                </div>
              </CardContent>
            ) : null}
          </Card>
        </MotionCard>

        <MotionCard>
          <Card className="shadow-elevation-low">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" />
                AI
              </CardTitle>
              <CardDescription>
                {aiConfigured
                  ? "Quick-add and insight narration are powered by Claude."
                  : "AI features aren't fully enabled yet. Quick-add and insight narration return realistic canned responses in the meantime."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant={aiConfigured ? "default" : "secondary"}>
                {aiConfigured ? "Live" : "Demo mode"}
              </Badge>
            </CardContent>
          </Card>
        </MotionCard>

        {hasConnectedAccounts ? (
          <MotionCard>
            <Card className="shadow-elevation-low">
              <CardHeader>
                <CardTitle>Connected accounts</CardTitle>
                {/* Monetization pass: automatic, scheduled watchdog sync is
                    the Pro axis (see connected-account-sync-job.ts's own
                    header comment) — this line is the one place that fact
                    reaches a user looking directly at their connections,
                    framed as what Pro adds ("keeps watching automatically"),
                    never as "this doesn't work" for Free. Manual sync via
                    Import Center is unaffected either way — nothing here
                    claims otherwise. */}
                <CardDescription>
                  {isPaid
                    ? "Bank and email connections used to detect subscriptions automatically."
                    : "Bank and email connections — sync manually anytime from Import Center. Pro keeps watching automatically every day, so you don't have to."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {emailConnection ? (
                  <ConnectedAccountRow
                    label="Google (Gmail)"
                    detail={`Connected as ${emailConnection.emailAddress}`}
                    disconnectUrl="/api/imports/gmail/disconnect"
                  />
                ) : null}
                {plaidConnections.length > 0 ? (
                  <ConnectedAccountRow
                    label="Plaid"
                    detail={
                      plaidConnections.length === 1
                        ? (plaidConnections[0].institutionName ?? "1 bank connected")
                        : `${plaidConnections.length} banks connected`
                    }
                    disconnectUrl="/api/imports/plaid/disconnect"
                  />
                ) : null}
                {truelayerConnections.length > 0 ? (
                  <ConnectedAccountRow
                    label="TrueLayer"
                    detail={
                      truelayerConnections.length === 1
                        ? (truelayerConnections[0].institutionName ?? "1 bank connected")
                        : `${truelayerConnections.length} banks connected`
                    }
                    disconnectUrl="/api/imports/truelayer/disconnect"
                  />
                ) : null}
              </CardContent>
            </Card>
          </MotionCard>
        ) : null}

        <MotionCard>
          <DeleteAccountCard />
        </MotionCard>

        {/* UI audit finding #5 (P2): this row used to also carry its own
            LogoutButton — a second "Log out" affordance on top of the
            global one every authenticated page already has in its header
            (see (app)/layout.tsx). The header's stays as the one,
            consistent-everywhere logout control; this page no longer
            duplicates it. */}
        <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to dashboard
        </Link>

        <nav aria-label="Legal" className="flex items-center gap-4 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">Terms of Service</Link>
        </nav>
      </StaggerSection>
    </div>
  );
}
