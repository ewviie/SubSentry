"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        toast.error(data?.message ?? "Couldn't open the billing portal. Try again.");
        setLoading(false);
        return;
      }
      // Leave loading=true — the page is about to navigate away.
      window.location.href = data.url;
    } catch {
      toast.error("Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      Manage billing
    </Button>
  );
}
