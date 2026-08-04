"use client";

import { CreditCard, Landmark, PlayCircle, Smartphone, type LucideIcon } from "lucide-react";
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
}

// Deliberately a static list, not pulled from the server-side provider
// registry (src/lib/imports/registry.ts) — that registry exists so the
// analyze route can dispatch by source without branching, not so the UI
// needs to introspect it. `enabled` here is kept in sync with each
// provider's own `enabled` flag by hand — it's UI-only cosmetic metadata
// (icons, marketing copy) the registry has no reason to expose.
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
    label: "Apple Subscriptions",
    description: "Import your Apple subscription export to detect active App Store subscriptions.",
    icon: Smartphone,
    enabled: true,
  },
  {
    id: "google_play",
    label: "Google Play",
    description: "Import exported Google Play subscription information.",
    icon: PlayCircle,
    enabled: true,
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

export const SOURCE_LABELS: Record<ImportSourceId, string> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s.label]),
) as Record<ImportSourceId, string>;

export function SourcePicker({
  onSelect,
  plaidEnabled = false,
  trueLayerEnabled = false,
}: {
  onSelect: (source: ImportSourceId) => void;
  plaidEnabled?: boolean;
  trueLayerEnabled?: boolean;
}) {
  const sources = SOURCES.map((source) => {
    if (source.id === "plaid") return { ...source, enabled: plaidEnabled };
    if (source.id === "truelayer") return { ...source, enabled: trueLayerEnabled };
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
                Select
              </Button>
            </CardContent>
          </Card>
        </MotionCard>
      ))}
    </StaggerSection>
  );
}
