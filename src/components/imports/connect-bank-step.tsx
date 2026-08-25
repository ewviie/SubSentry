"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Button } from "@/components/ui/button";

// The two live-API providers connect very differently: Plaid Link is an
// in-page JS modal (usePlaidLink), TrueLayer is a full-page OAuth redirect
// (see /api/imports/truelayer/authorize), so this dispatches to a
// dedicated subcomponent per provider rather than branching mid-render,
// keeping usePlaidLink's unconditional-hook-call requirement satisfied.
export function ConnectBankStep({
  source,
  onConnected,
  onError,
}: {
  source: "plaid" | "truelayer";
  onConnected: () => void;
  onError: (message: string) => void;
}) {
  return source === "plaid" ? (
    <ConnectPlaid onConnected={onConnected} onError={onError} />
  ) : (
    <ConnectTrueLayer />
  );
}

function ConnectTrueLayer() {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-ai-muted text-ai">
        <Landmark className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Connect your bank with TrueLayer</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          You&apos;ll be redirected to TrueLayer to securely sign in to your bank. SubSentry never sees your
          credentials.
        </p>
      </div>
      <Button render={<a href="/api/imports/truelayer/authorize" />} nativeButton={false}>
        Connect with TrueLayer
      </Button>
    </div>
  );
}

function ConnectPlaid({
  onConnected,
  onError,
}: {
  onConnected: () => void;
  onError: (message: string) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(true);
  const [exchanging, setExchanging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/imports/plaid/link-token", { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          onError(data?.message ?? "Couldn't start the bank connection. Try again.");
          return;
        }
        setLinkToken(data.linkToken);
      })
      .catch(() => {
        if (!cancelled) onError("Network error. Try again.");
      })
      .finally(() => {
        if (!cancelled) setFetchingToken(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once per mount only: re-running on onError identity churn would
    // spend another rate-limited /link-token call for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSuccess: PlaidLinkOnSuccess = useCallback(
    (publicToken, metadata) => {
      setExchanging(true);
      fetch("/api/imports/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken, institutionName: metadata.institution?.name ?? null }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            onError(data?.message ?? "Couldn't finish connecting your bank. Try again.");
            setExchanging(false);
            return;
          }
          onConnected();
        })
        .catch(() => {
          onError("Network error. Try again.");
          setExchanging(false);
        });
    },
    [onConnected, onError],
  );

  const { open, ready } = usePlaidLink({ token: linkToken ?? "", onSuccess });
  const busy = fetchingToken || exchanging;

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-ai-muted text-ai">
        {busy ? (
          <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Landmark className="size-5" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-1">
        <p className="font-medium">Connect your bank with Plaid</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Plaid securely connects to your bank. SubSentry never sees or stores your credentials.
        </p>
      </div>
      <Button disabled={!ready || busy} onClick={() => open()}>
        {exchanging ? "Connecting…" : "Connect with Plaid"}
      </Button>
    </div>
  );
}
