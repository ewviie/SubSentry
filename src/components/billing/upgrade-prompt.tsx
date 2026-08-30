import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── The one shared "this is a Pro feature" UI, everywhere it appears ──────
// Before this, the dashboard's own PremiumLocked (insight-panels.tsx) was
// the only such component, and every other gated surface this pass adds
// (Health Score dimension preview, Analytics, subscription detail, the
// subscription-count limit banner, the AI quick-add limit) would otherwise
// have reinvented its own version — exactly the "different design on every
// page" section 13 of the monetization pass asked not to do. Three shapes
// (UpgradeCard, UpgradeInline, UpgradeLimitBanner) cover every place this
// pass needs one; PremiumLocked itself is retired in favor of UpgradeCard.
//
// Every variant takes the same two entitlement-derived props rather than
// computing anything itself: `beta` (isBetaAllAccess(), from
// lib/billing/plan.ts) and `upgradeUrl` (getUpgradeUrl(userId), null during
// the beta or when no payment link is configured yet). Neither of those is
// ever read here — this file is pure presentation, so it can safely be
// imported from a Client Component (quick-add-bar.tsx's rate-limit prompt)
// as well as every Server Component page that renders one of these.
//
// Plain <a>, not next/link's <Link>, for upgradeUrl: it's always an
// external Stripe URL (see getUpgradeUrl's own comment), never one of this
// app's own typed routes — the same reason settings/page.tsx's own upgrade
// link already uses a plain anchor instead of <Link>.
//
// Copy conventions follow section 18 of the monetization pass: "Unlock with
// Pro" / "Pro feature" / "Upgrade to Pro" / "Free during beta" — never
// urgency, scarcity, or countdown language, and never a button that does
// nothing (see UpgradeCta below for exactly when a real link renders vs.
// plain text).
function fallbackNote(beta: boolean): string {
  return beta ? "Free during the beta. No card required." : "Upgrades aren't open yet — check back soon.";
}

// The one place that decides "does this render as a working link, or plain
// text" — beta and "not configured yet" both have nothing to link to, and a
// button that looks live but does nothing is exactly the fake-CTA pattern
// this pass explicitly rules out. Real production behavior once beta ends
// and a payment link exists needs no other change anywhere in this file.
// `full`: block-level, full-width button (UpgradeCard's own use, were it
// ever needed) vs. the compact inline button UpgradeCard/UpgradeLimitBanner
// actually use, sized against a Badge on the same row.
function UpgradeCta({
  beta,
  upgradeUrl,
  label,
  atLimitLabel,
  atLimit = false,
}: {
  beta: boolean;
  upgradeUrl: string | null;
  label: string;
  atLimitLabel?: string;
  atLimit?: boolean;
}) {
  if (!beta && upgradeUrl) {
    return (
      <Button size="sm" render={<a href={upgradeUrl} />} nativeButton={false}>
        {atLimit && atLimitLabel ? atLimitLabel : label}
      </Button>
    );
  }
  return <Badge className="bg-emerald text-emerald-foreground">{beta ? "Free during beta" : "Coming soon"}</Badge>;
}

export interface UpgradeCardProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  beta: boolean;
  upgradeUrl: string | null;
  /** Real, already-computed value shown above the gate (e.g. the 5 Health
   * Score dimension names, or an overview panel's own preview number) —
   * "show the value, gate the depth," never an empty locked box. Omit when
   * there's genuinely nothing free to preview. */
  preview?: React.ReactNode;
  className?: string;
}

// The full-card shape: a locked section that used to render nothing (or
// just PremiumLocked's single terse line) for a free-plan caller —
// Optimization recommendations, Risk alerts, Unrealized savings, a
// subscription's deeper cost analysis. Framed as a value statement first
// ("See which subscriptions could be reduced or replaced"), the "Pro
// feature" label second, never the other way around — the awareness →
// curiosity → value → upgrade progression section 16 describes.
export function UpgradeCard({ icon: Icon = Lock, title, description, beta, upgradeUrl, preview, className }: UpgradeCardProps) {
  return (
    <Card size="sm" className={cn("shadow-elevation-low", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {preview}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">Pro feature</span>
          </div>
          <UpgradeCta beta={beta} upgradeUrl={upgradeUrl} label="Unlock with Pro" />
        </div>
      </CardContent>
    </Card>
  );
}

// The compact shape: one line, for a spot inside an already-rendered list
// or card rather than a whole section of its own — e.g. after a teased
// savings recommendation, or a chart's own caption. Never its own bordered
// box; it reads as part of the content it's attached to.
export function UpgradeInline({
  label = "Unlock with Pro",
  beta,
  upgradeUrl,
  className,
}: {
  label?: string;
  beta: boolean;
  upgradeUrl: string | null;
  className?: string;
}) {
  if (!beta && upgradeUrl) {
    return (
      <a
        href={upgradeUrl}
        className={cn("inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4", className)}
      >
        {label} →
      </a>
    );
  }
  return <span className={cn("text-sm text-muted-foreground", className)}>{fallbackNote(beta)}</span>;
}

// The progressive subscription-count shape (section 9): "4 of 5 used" while
// there's still room, a firmer "you've reached the limit" once there isn't
// — surfaced before a free user ever hits the hard server-side block on
// /api/subscriptions or /api/imports/confirm, not only after. Callers pass
// real, already-computed activeCount/limit; nothing here invents a number.
// Never rendered at all once beta or a real Pro plan removes the
// limit — see each call site's own `!isPremium` guard, the same one every
// other gate in this file relies on to disappear automatically once
// isBetaAllAccess() (or a real upgrade) grants full access.
export function UpgradeLimitBanner({
  current,
  limit,
  beta,
  upgradeUrl,
  className,
}: {
  current: number;
  limit: number;
  beta: boolean;
  upgradeUrl: string | null;
  className?: string;
}) {
  const atLimit = current >= limit;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
        atLimit ? "border-warning/30 bg-warning/10" : "border-border bg-muted/30",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {atLimit ? `You've reached the Free plan limit (${limit} of ${limit}).` : `${current} of ${limit} Free subscriptions used.`}
        </p>
        <p className="text-sm text-muted-foreground">Pro includes unlimited active subscriptions.</p>
      </div>
      <div className="shrink-0">
        <UpgradeCta beta={beta} upgradeUrl={upgradeUrl} label="Upgrade to Pro" atLimitLabel="Upgrade for unlimited" atLimit={atLimit} />
      </div>
    </div>
  );
}
