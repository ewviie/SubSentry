import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { isAIConfigured } from "@/lib/ai/provider";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl } from "@/lib/billing/plan";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/app-shell/logout-button";

export default async function SettingsPage() {
  const user = await requireUser();
  // Only free-plan users ever see activeCount (pro shows "unlimited"), so
  // skip the fetch entirely for pro — same reasoning as the plan-limit
  // check in api/subscriptions/route.ts.
  const activeCount =
    user.plan === "free"
      ? (await listSubscriptions(user.id)).filter((s) => s.status === "active").length
      : 0;
  const upgradeUrl = user.plan === "free" ? getUpgradeUrl(user.id) : null;
  const aiConfigured = isAIConfigured();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{user.name || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user.email}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Billing
            <Badge variant={user.plan === "pro" ? "default" : "secondary"}>
              {user.plan === "pro" ? "Pro" : "Free"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {user.plan === "pro"
              ? "You have unlimited subscriptions."
              : `Free plan: up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions (${activeCount}/${FREE_PLAN_SUBSCRIPTION_LIMIT} used).`}
          </CardDescription>
        </CardHeader>
        {upgradeUrl ? (
          <CardContent>
            <Button render={<a href={upgradeUrl} />} nativeButton={false}>
              Upgrade to Pro
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai" />
            AI
          </CardTitle>
          <CardDescription>
            {aiConfigured
              ? "Quick-add and insight narration are powered by Claude."
              : "Running in demo mode — quick-add and insight narration return realistic canned responses. Set ANTHROPIC_API_KEY to enable live AI."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant={aiConfigured ? "default" : "secondary"}>
            {aiConfigured ? "Live" : "Demo mode"}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <LogoutButton />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="underline underline-offset-4">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
