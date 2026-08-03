import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { isAIConfigured } from "@/lib/ai/provider";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl, isBillingPortalConfigured } from "@/lib/billing/plan";
import { initials } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { EditNameForm } from "@/components/settings/edit-name-form";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { FadeInSection } from "@/components/dashboard/fade-in-section";

const PRO_BENEFITS = [
  "Unlimited active subscriptions",
  "Everything in Free",
  "Priority support",
];

export default async function SettingsPage() {
  const user = await requireUser();
  const activeCount =
    user.plan === "free"
      ? (await listSubscriptions(user.id)).filter((s) => s.status === "active").length
      : 0;
  const upgradeUrl = user.plan === "free" ? getUpgradeUrl(user.id) : null;
  const aiConfigured = isAIConfigured();
  const portalConfigured = isBillingPortalConfigured();

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback className="bg-gold-muted text-base font-semibold text-gold">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-heading text-h1 font-semibold">{user.name || user.email}</h1>
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

        <Card
          className={
            user.plan === "pro"
              ? "border-gold/30 shadow-elevation-glow ring-1 ring-gold/20"
              : "shadow-elevation-low"
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Plan &amp; billing
              <Badge
                className={user.plan === "pro" ? "bg-gold text-gold-foreground" : undefined}
                variant={user.plan === "pro" ? undefined : "secondary"}
              >
                {user.plan === "pro" ? "Pro" : "Free"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {user.plan === "pro"
                ? "You have unlimited subscriptions."
                : `Up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions.`}
            </CardDescription>
          </CardHeader>
          {user.plan === "pro" && portalConfigured && user.stripeCustomerId ? (
            <CardContent>
              <ManageBillingButton />
            </CardContent>
          ) : null}
          {user.plan === "free" ? (
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
                    className="h-full rounded-full bg-gold"
                    style={{
                      width: `${Math.min((activeCount / FREE_PLAN_SUBSCRIPTION_LIMIT) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
              {upgradeUrl ? (
                <div className="rounded-lg border border-gold/20 bg-gold-muted/40 p-4">
                  <p className="text-sm font-medium">Upgrade to Pro: £4.99/mo</p>
                  <ul className="mt-2 space-y-1.5">
                    {PRO_BENEFITS.map((benefit) => (
                      <li key={benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
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
                : "Running in demo mode. Quick-add and insight narration return realistic canned responses. Set ANTHROPIC_API_KEY to enable live AI."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={aiConfigured ? "default" : "secondary"}>
              {aiConfigured ? "Live" : "Demo mode"}
            </Badge>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to dashboard
          </Link>
          <LogoutButton />
        </div>
      </FadeInSection>
    </div>
  );
}
