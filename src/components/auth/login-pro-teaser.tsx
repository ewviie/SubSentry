import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { isBetaAllAccess } from "@/lib/billing/plan";
import { PRO_MONTHLY_PRICE, PRO_FEATURES } from "@/lib/billing/pro-features";

// A compact reminder of what Pro is, shown under the login form for a
// returning user — not a redesign of the login page itself (see
// login/page.tsx: this renders below <LoginForm>, never inside it). Reads
// from the same PRO_FEATURES/PRO_MONTHLY_PRICE (lib/billing/pro-features.ts)
// pricing-section.tsx and Settings → Plan & Billing already use, so this
// can never drift into a different feature list or price than either of
// those. Server Component: isBetaAllAccess() (lib/billing/plan.ts) is plain
// and safe to call directly here.
//
// No CTA link here, on purpose, even post-beta: getUpgradeUrl(userId)
// (lib/billing/plan.ts) needs a real authenticated user's id to build a
// Stripe Payment Link's client_reference_id, and there is no session yet on
// this page — a visitor is trying to log in, not logged in. Settings → Plan
// & Billing is the one place that real link renders (see settings/page.tsx),
// once a session exists to attribute it to. A button here would either be
// unattributed (broken) or fake; this states the price honestly instead.
export function LoginProTeaser() {
  const beta = isBetaAllAccess();

  return (
    <Card size="sm" highlight className="w-full">
      <CardHeader>
        <CardTitle className="text-base">SubSentry Pro</CardTitle>
        <CardDescription>Everything. One subscription.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5 text-sm">
          {PRO_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald" aria-hidden="true" />
              <span className="text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>
        {/* Beta-aware the same way pricing-section.tsx/final-cta-section.tsx
            already are: nothing to actually charge anyone for right now, so
            this says so instead of implying a real purchase. Once the beta
            ends this reverts, with no other change needed, to pointing a
            returning user at the one place a real "Upgrade to Pro" link can
            correctly render for them (Settings, once they're logged in and
            have a real session to attribute it to) — never a button here
            that looks live but does nothing. */}
        {beta ? (
          <p className="text-xs text-muted-foreground">
            Free during the beta — {PRO_MONTHLY_PRICE}/month after. No card required.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{PRO_MONTHLY_PRICE}/month. Log in, then upgrade from Settings.</p>
        )}
      </CardContent>
    </Card>
  );
}
