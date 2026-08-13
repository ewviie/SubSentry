import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { isAIConfigured } from "@/lib/ai/provider";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl, isBillingPortalConfigured, hasPaidAccess, isBetaAllAccess } from "@/lib/billing/plan";
import { initials } from "@/lib/utils";
import { getEmailConnection } from "@/lib/imports/email-connections";
import { listBankConnections } from "@/lib/imports/bank-connections";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { EditNameForm } from "@/components/settings/edit-name-form";
import { RenewalReminderToggle } from "@/components/settings/renewal-reminder-toggle";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { ConnectedAccountRow } from "@/components/settings/connected-account-row";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { FadeInSection } from "@/components/dashboard/fade-in-section";

const PRO_BENEFITS = [
  "Unlimited active subscriptions",
  "Everything in Free",
  "Priority support",
];

export default async function SettingsPage() {
  const user = await requireUser();
  const isPaid = hasPaidAccess(user.plan);
  const activeCount = isPaid ? 0 : (await listSubscriptions(user.id)).filter((s) => s.status === "active").length;
  const upgradeUrl = isPaid ? null : getUpgradeUrl(user.id);
  const aiConfigured = isAIConfigured();
  const portalConfigured = isBillingPortalConfigured();
  const beta = isBetaAllAccess();

  // Self-service disconnect surface for every live-API import connection —
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
        {/* min-w-0 + break-words — same fix and reasoning as
            dashboard/page.tsx's identical header row: a flex item's
            automatic minimum width defaults to its content's min-content
            size, and a name-less account's email (no natural break
            point) forced this row wider than the viewport on mobile
            without min-w-0 to allow it to shrink and break-words to give
            the now-shrunk text somewhere to wrap. */}
        <div className="min-w-0">
          <h1 className="break-words font-heading text-h1 font-semibold">{user.name || user.email}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your account, plan, and AI configuration.
          </p>
        </div>
      </div>

      <FadeInSection className="mt-6 space-y-6">
        <Card className="shadow-elevation-low">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your account details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <EditNameForm initialName={user.name ?? ""} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{user.email}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-elevation-low">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>What SubSentry emails you about.</CardDescription>
          </CardHeader>
          <CardContent>
            <RenewalReminderToggle initialEnabled={user.renewalRemindersEnabled} />
          </CardContent>
        </Card>

        <Card highlight={isPaid} className={isPaid ? undefined : "shadow-elevation-low"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Plan &amp; billing
              <Badge className={isPaid ? "bg-emerald text-emerald-foreground" : undefined} variant={isPaid ? undefined : "secondary"}>
                {beta ? "Beta — full access" : user.plan === "pro" ? "Pro" : "Free"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {isPaid
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
              {upgradeUrl ? (
                <div className="rounded-lg border border-emerald/20 bg-emerald-muted/40 p-4">
                  <p className="text-sm font-medium">Upgrade to Pro: £4.99/mo</p>
                  <ul className="mt-2 space-y-1.5">
                    {PRO_BENEFITS.map((benefit) => (
                      <li key={benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="size-3.5 shrink-0 text-emerald" aria-hidden="true" />
                        {benefit}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-3" render={<a href={upgradeUrl} />} nativeButton={false}>
                    Upgrade to Pro
                  </Button>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

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

        {hasConnectedAccounts ? (
          <Card className="shadow-elevation-low">
            <CardHeader>
              <CardTitle>Connected accounts</CardTitle>
              <CardDescription>Bank and email connections used to detect subscriptions automatically.</CardDescription>
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
        ) : null}

        <DeleteAccountCard />

        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to dashboard
          </Link>
          <LogoutButton />
        </div>

        <nav aria-label="Legal" className="flex items-center gap-4 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">Terms of Service</Link>
        </nav>
      </FadeInSection>
    </div>
  );
}
