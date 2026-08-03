"use client";

import { useEffect, useRef } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Mounted once in the (app) layout. Stripe's Payment Link confirmation page
// redirects to `/dashboard?checkout_session_id={CHECKOUT_SESSION_ID}` (see
// .env.example) — this picks that up on whatever page it lands on, redeems
// it, then strips the query param so a refresh doesn't re-trigger it.
export function CheckoutActivator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    const checkoutSessionId = searchParams.get("checkout_session_id");
    if (!checkoutSessionId || handled.current) return;
    handled.current = true;

    const url = new URL(window.location.href);
    url.searchParams.delete("checkout_session_id");
    router.replace((url.pathname + url.search) as Route);

    fetch("/api/billing/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutSessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.error(data?.message ?? "Couldn't confirm your upgrade. Contact support if this persists.");
          return;
        }
        toast.success("You're on Pro. Unlimited subscriptions unlocked.");
        router.refresh();
      })
      .catch(() => {
        toast.error("Couldn't confirm your upgrade. Contact support if this persists.");
      });
  }, [searchParams, router]);

  return null;
}
