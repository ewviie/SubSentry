import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { isDevPlanPreviewAvailable, DEV_PLAN_PREVIEW_COOKIE } from "@/lib/dev/plan-preview";

// The one endpoint that writes the dev-preview cookie — see
// lib/dev/plan-preview.ts's own comment for the full mechanism. Fails
// closed (404, before even checking the session) outside development, the
// same unconditional NODE_ENV guard getDevPlanPreview() itself uses, so
// this route doesn't exist as an attack surface in a real deployment
// regardless of what's in a misconfigured production env.
export async function POST(request: Request) {
  if (!isDevPlanPreviewAvailable()) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  // Still requires a real session — this is a dev convenience, not a route
  // that should respond to an unauthenticated request just because it's
  // dev-only. Cookie set here only ever changes what *this same browser's*
  // own session sees.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const plan = body && typeof body === "object" && "plan" in body ? body.plan : null;
  const cookieStore = await cookies();

  if (plan === "free" || plan === "pro") {
    // httpOnly: the banner never needs to read this value client-side — the
    // server (getSession → the layout that renders the banner) is what
    // resolves and displays the current preview state, so there's no
    // reason to expose the cookie to page JS at all.
    cookieStore.set(DEV_PLAN_PREVIEW_COOKIE, plan, { httpOnly: true, sameSite: "lax", path: "/" });
  } else {
    cookieStore.delete(DEV_PLAN_PREVIEW_COOKIE);
  }

  return NextResponse.json({ ok: true });
}
