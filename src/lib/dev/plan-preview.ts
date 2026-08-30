import { cookies } from "next/headers";
import { hasPaidAccess, FREE_PLAN_SUBSCRIPTION_LIMIT } from "@/lib/billing/plan";
import type { User } from "@/lib/db/schema";

// ─── Dev-only Free/Pro preview ──────────────────────────────────────────────
// Lets a developer see the real (non-beta) Free/Pro experience from a
// floating banner in the running app, switching between Free and Pro live
// from the browser — see components/dev/dev-plan-preview-banner.tsx for the
// UI and resolveHasPaidAccess/resolveHasReachedSubscriptionLimit below for
// the integration: every server-only caller that currently calls
// hasPaidAccess/hasReachedSubscriptionLimit directly (dashboard/settings/
// savings/subscriptions pages, queries.ts, the plan-aware AI rate limiters)
// calls one of these two wrappers instead, which check the preview first
// and otherwise defer to the real, unmodified function in
// lib/billing/plan.ts. This is not a second plan system — the database's
// `plan` column, the Stripe webhook, and hasPaidAccess's own real logic are
// all untouched; this only ever supplies an answer *before* that logic
// runs, for the one browser that set the cookie.
//
// This module (and everything that imports from it) is server-only: it
// depends on next/headers, which cannot be bundled into client code.
// lib/billing/plan.ts itself is deliberately kept free of that dependency
// — hero-section.tsx and final-cta-section.tsx are Client Components that
// call its isBetaAllAccess() directly, so that file must stay import-safe
// for a browser bundle. hasPaidAccess/hasReachedSubscriptionLimit
// themselves are plain, synchronous, and completely unaware this file
// exists; only the wrappers below know about the preview.
//
// isAvailable()'s NODE_ENV check is the actual, unconditional safety
// boundary, not a convention: `next build`/`next start` set
// NODE_ENV=production themselves (this app never sets it), so every
// function below returns null/false — or defers straight to the real,
// beta-gated function — before ever reading the cookie in a real
// deployment, even if one were somehow present.
export const DEV_PLAN_PREVIEW_COOKIE = "dev_plan_preview";

export type DevPlanPreview = "free" | "pro";

export function isDevPlanPreviewAvailable(): boolean {
  return process.env.NODE_ENV !== "production";
}

// Read from any Server Component or Route Handler that needs to know the
// active preview (or that there isn't one) — used directly only where
// something other than a plain paid-access boolean is needed (the Settings
// page's "Beta: full access" badge, and the banner's own current-state
// display). Safe to call completely unconditionally, from anywhere —
// including a plain unit test or any other context with no real HTTP
// request at all: next/headers' cookies() throws (not just returns empty)
// outside a genuine request scope, and this whole mechanism needs to stay
// inert rather than crash whatever unrelated code happens to call it.
export async function getDevPlanPreview(): Promise<DevPlanPreview | null> {
  if (!isDevPlanPreviewAvailable()) return null;
  try {
    const value = (await cookies()).get(DEV_PLAN_PREVIEW_COOKIE)?.value;
    return value === "free" || value === "pro" ? value : null;
  } catch {
    return null;
  }
}

// The dev-preview-aware drop-in for hasPaidAccess(plan) — every page/route
// that currently calls hasPaidAccess directly should call this instead.
// Every call site must await this: a forgotten await would silently grant
// Premium to everyone, since a Promise is always truthy in a boolean
// check. Page call sites are covered by TypeScript itself (Promise<boolean>
// isn't assignable where a boolean prop is declared); a bare `if (...)`
// condition is not, so check those by hand.
export async function resolveHasPaidAccess(plan: User["plan"]): Promise<boolean> {
  const preview = await getDevPlanPreview();
  if (preview) return preview === "pro";
  return hasPaidAccess(plan);
}

// The dev-preview-aware drop-in for hasReachedSubscriptionLimit(plan,
// activeCount). Delegates to resolveHasPaidAccess above rather than
// re-deriving the preview itself, so there is exactly one place ("is paid
// access unlocked, given any active preview") this logic lives; the
// `!isPaid && activeCount >= LIMIT` arithmetic itself is intentionally the
// same one-line expression hasReachedSubscriptionLimit already uses,
// duplicated rather than threaded through more indirection because there
// is no way to make the real function honor a preview without either this
// or making it (and every one of its own call sites and tests) async and
// aware of next/headers, which would defeat the point of keeping plan.ts
// itself dependency-free.
export async function resolveHasReachedSubscriptionLimit(plan: User["plan"], activeCount: number): Promise<boolean> {
  const isPaid = await resolveHasPaidAccess(plan);
  return !isPaid && activeCount >= FREE_PLAN_SUBSCRIPTION_LIMIT;
}
