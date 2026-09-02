import { z } from "zod";
import { getAIProvider } from "./provider";
import { subscriptionInputSchema, type SubscriptionInput } from "@/lib/subscriptions/validation";

// Capped well above any real "Netflix £10.99 monthly"-style input, but far
// below what would let someone stuff a large payload into the AI call —
// shared by the single quick-add route (api/subscriptions/quick-add) and
// bulk quick-add's own per-line check (lib/ai/bulk-quick-add.ts), so a line
// pasted into the bulk flow is held to the exact same bound as one typed
// into the single-item bar, not a second, independently-drifting copy of
// the same two numbers.
export const quickAddLineSchema = z
  .string()
  .trim()
  .min(3, "Tell me a bit more")
  .max(280, "Keep it under 280 characters");

export type QuickAddResult =
  | { ok: true; subscription: SubscriptionInput; confidence: "high" | "medium" | "low" }
  | { ok: false; error: string };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Orchestrates the quick-add flow: call the provider, then re-validate its
// output through the exact same zod schema the manual add form uses. The
// model's output is never trusted directly — a hallucinated or
// out-of-range field is rejected here, before it ever reaches the create
// endpoint, the same way a malformed manual form submission would be.
export async function quickAddSubscription(text: string): Promise<QuickAddResult> {
  const provider = getAIProvider();

  let parsed;
  try {
    parsed = await provider.parseSubscriptionText(text, todayISO());
  } catch {
    return { ok: false, error: "Couldn't reach the AI parser. Try again or enter it manually." };
  }

  // When the model couldn't determine a date, don't silently guess "today"
  // — that's a real date that could be wrong in either direction and would
  // look just as confident as a genuinely-parsed one. Validate every other
  // field against a placeholder date, then hand back an empty date field;
  // the confirm form's `required` date input forces the user to actually
  // pick one before it can be saved.
  const dateProvided = Boolean(parsed.nextRenewalDate);
  const candidate = {
    name: parsed.name,
    amount: parsed.amount,
    currency: parsed.currency,
    billingCycle: parsed.billingCycle,
    category: parsed.category,
    nextRenewalDate: parsed.nextRenewalDate ?? "2099-01-01",
    status: "active" as const,
  };

  const validated = subscriptionInputSchema.safeParse(candidate);
  if (!validated.success) {
    return {
      ok: false,
      error: "Couldn't quite understand that. Try rephrasing, or enter it manually below.",
    };
  }

  return {
    ok: true,
    subscription: { ...validated.data, nextRenewalDate: dateProvided ? validated.data.nextRenewalDate : "" },
    confidence: parsed.confidence,
  };
}
