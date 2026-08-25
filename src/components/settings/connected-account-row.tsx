"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shared by every "connected account" row in Settings (Gmail, Plaid,
// TrueLayer): each just supplies its own disconnectUrl. Success just
// refreshes the Server Component tree (this page re-fetches connection
// status server-side) rather than tracking removed-state locally, so this
// can't drift from what's actually in the database after the call.
export function ConnectedAccountRow({
  label,
  detail,
  disconnectUrl,
}: {
  label: string;
  detail: string;
  disconnectUrl: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch(disconnectUrl, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Couldn't disconnect. Try again.");
        setDisconnecting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{detail}</p>
        {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      </div>
      <Button variant="outline" size="sm" onClick={() => void handleDisconnect()} disabled={disconnecting}>
        {disconnecting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : "Disconnect"}
      </Button>
    </div>
  );
}
