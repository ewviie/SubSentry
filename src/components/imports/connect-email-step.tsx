"use client";

import { useState } from "react";
import { Mail, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

// Matches src/lib/imports/history.ts's identical formatter, same
// "medium date, short time" shape used everywhere else in this app that
// shows a timestamp to a user, not a bespoke relative-time ("3 minutes
// ago") library added just for this one label.
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// Gmail is a full-page OAuth redirect (see /api/imports/gmail/authorize
// and .../callback), the same shape as ConnectBankStep's TrueLayer case,
// not an in-page JS modal like Plaid Link, since Google's own consent
// screen has to be a real page the user's browser lands on.
export function ConnectEmailStep({
  connectedEmail,
  lastSyncedAt,
  onSync,
  onDisconnected,
  onError,
}: {
  connectedEmail: string | null;
  lastSyncedAt: string | null;
  onSync: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
}) {
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/imports/gmail/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        onError(data?.message ?? "Couldn't disconnect your Google account. Try again.");
        return;
      }
      onDisconnected();
    } catch {
      onError("Network error. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (connectedEmail) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-emerald-muted text-emerald">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">
            Connected as <span className="text-foreground">{connectedEmail}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {lastSyncedAt
              ? `Last synced ${dateTimeFormatter.format(new Date(lastSyncedAt))}`
              : "Never synced yet."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={onSync} disabled={disconnecting}>
            Sync now
          </Button>
          <Button variant="outline" onClick={() => void handleDisconnect()} disabled={disconnecting}>
            {disconnecting ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Disconnecting…
              </>
            ) : (
              "Disconnect"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-ai-muted text-ai">
        <Mail className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <p className="font-medium">Connect your Google account</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          You&apos;ll be redirected to Google to grant read-only access to your Gmail. SubSentry only reads
          subscription-related emails (receipts, renewal notices) to detect charges. It can never send, delete, or
          modify anything in your inbox, and never sees your Google password.
        </p>
      </div>
      <Button render={<a href="/api/imports/gmail/authorize" />} nativeButton={false}>
        Connect Google
      </Button>
    </div>
  );
}
