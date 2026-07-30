import type { BILLING_CYCLES, CATEGORIES } from "@/lib/subscriptions/validation";
import type { ComputedInsight } from "@/lib/subscriptions/insights";
import { AnthropicProvider } from "./anthropic-provider";
import { DemoProvider } from "./demo-provider";

export interface ParsedSubscriptionResult {
  name: string;
  amount: string;
  currency: string;
  billingCycle: (typeof BILLING_CYCLES)[number];
  category: (typeof CATEGORIES)[number];
  nextRenewalDate: string | null;
  confidence: "high" | "medium" | "low";
}

// The provider surface is intentionally small and text-in/text-out (or
// structured-JSON-out) so a different model or vendor can implement it
// without touching any call site — src/lib/ai/parse-subscription.ts and
// src/lib/subscriptions/insights.ts depend on this interface, never on a
// specific SDK.
export interface AIProvider {
  parseSubscriptionText(text: string, today: string): Promise<ParsedSubscriptionResult>;
  narrateInsights(insights: ComputedInsight[]): Promise<string[]>;
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cachedProvider: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (!cachedProvider) {
    cachedProvider = isAIConfigured() ? new AnthropicProvider() : new DemoProvider();
  }
  return cachedProvider;
}
