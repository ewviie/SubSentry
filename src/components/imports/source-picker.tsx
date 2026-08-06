"use client";

import { CreditCard, Landmark, Mail, Smartphone, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import type { ImportSourceId } from "@/lib/imports/provider";

interface SourceOption {
  id: ImportSourceId;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  // Defaults to "Select" below — only overridden where the generic label
  // would misrepresent what actually happens next (see gmail/apple).
  buttonLabel?: string;
}

// Deliberately a static list, not pulled from the server-side provider
// registry (src/lib/imports/registry.ts) — that registry exists so the
// analyze route can dispatch by source without branching, not so the UI
// needs to introspect it. `enabled` here is kept in sync with each
// provider's own `enabled` flag by hand — it's UI-only cosmetic metadata
// (icons, marketing copy) the registry has no reason to expose.
//
// google_play (the old CSV-upload "Google" option) is deliberately absent
// from this list — gmail (a real OAuth connection) replaced it as the
// active Google option. Its provider registration and CSV-parsing code
// are still intact (registry.ts), just not offered here anymore; see that
// file's comment.
const SOURCES: SourceOption[] = [
  {
    id: "csv_bank",
    label: "Bank CSV",
    description: "Upload a CSV exported from your bank to automatically detect recurring subscription payments.",
    icon: CreditCard,
    enabled: true,
  },
  {
    id: "apple",
    label: "Apple Data Export",
    // Explicit, upfront, rather than letting a "Connect"-shaped button
    // imply a live connection Apple doesn't actually offer: there is no
    // public API for a user's own cross-App-Store subscription list —
    // Sign in with Apple has no such scope, and the App Store Server API
    // is developer-side (an app's own transactions), not this. Exporting
    // your data yourself and uploading it here is the only real option.
    description:
      "Apple doesn't provide a way to connect your subscriptions directly. Export your data from Apple ID → Data & Privacy → \"Request a copy of your data\", then upload it here.",
    icon: Smartphone,
    enabled: true,
    buttonLabel: "Import Apple Data",
  },
  {
    id: "gmail",
    label: "Google (Gmail)",
    description:
      "Connect your Google account to scan Gmail for subscription receipts and renewal emails — read-only access, nothing is sent, deleted, or modified.",
    icon: Mail,
    enabled: false, // computed server-side from GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — see gmailEnabled prop
    buttonLabel: "Connect Google",
  },
  {
    id: "plaid",
    label: "Bank (Plaid)",
    description: "Securely connect your bank account via Plaid to automatically detect recurring subscriptions.",
    icon: Landmark,
    // Plaid requires PLAID_CLIENT_ID/PLAID_SECRET + TOKEN_ENCRYPTION_KEY —
    // see plaidEnabled prop, computed server-side from those env vars.
    enabled: false,
  },
  {
    id: "truelayer",
    label: "Bank (TrueLayer)",
    description: "Securely connect your bank account via TrueLayer to automatically detect recurring subscriptions.",
    icon: Landmark,
    enabled: false,
  },
];

export const SOURCE_LABELS: Record<ImportSourceId, string> = {
  ...(Object.fromEntries(SOURCES.map((s) => [s.id, s.label])) as Record<ImportSourceId, string>),
  // Not offered in SOURCES (see the comment above), but still a valid
  // ImportSourceId the analyze route's dispatch table and import-history
  // labels need to resolve — see registry.ts.
  google_play: "Google Play",
};

export function SourcePicker({
  onSelect,
  plaidEnabled = false,
  trueLayerEnabled = false,
  gmailEnabled = false,
}: {
  onSelect: (source: ImportSourceId) => void;
  plaidEnabled?: boolean;
  trueLayerEnabled?: boolean;
  gmailEnabled?: boolean;
}) {
  const sources = SOURCES.map((source) => {
    if (source.id === "plaid") return { ...source, enabled: plaidEnabled };
    if (source.id === "truelayer") return { ...source, enabled: trueLayerEnabled };
    if (source.id === "gmail") return { ...source, enabled: gmailEnabled };
    return source;
  });

  return (
    <StaggerSection className="grid gap-4 sm:grid-cols-3">
      {sources.map((source) => (
        <MotionCard key={source.id}>
          <Card
            className={
              source.enabled
                ? "h-full shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium"
                : "h-full opacity-70"
            }
          >
            <CardContent className="flex h-full flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex size-9 items-center justify-center rounded-full bg-ai-muted text-ai">
                  <source.icon className="size-4" aria-hidden="true" />
                </div>
                {source.enabled ? null : <Badge variant="secondary">Coming soon</Badge>}
              </div>
              <div>
                <p className="font-heading text-lg font-medium">{source.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{source.description}</p>
              </div>
              <Button
                className="mt-auto w-fit"
                variant="outline"
                disabled={!source.enabled}
                onClick={() => onSelect(source.id)}
              >
                {source.buttonLabel ?? "Select"}
              </Button>
            </CardContent>
          </Card>
        </MotionCard>
      ))}
    </StaggerSection>
  );
}
