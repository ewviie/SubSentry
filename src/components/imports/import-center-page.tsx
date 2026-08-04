"use client";

import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeQuick } from "@/lib/motion";
import { SourcePicker, SOURCE_LABELS } from "./source-picker";
import { FileUploadStep } from "./file-upload-step";
import { ConnectBankStep } from "./connect-bank-step";
import { AnalyzingStep } from "./analyzing-step";
import { ReviewTable } from "./review-table";
import { ImportCompleteStep } from "./import-complete-step";
import type { ImportSourceId } from "@/lib/imports/provider";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

type Step = "source" | "upload" | "connect" | "analyzing" | "review" | "complete";

const STEP_ORDER: Step[] = ["source", "upload", "analyzing", "review", "complete"];
const STEP_LABELS: Record<Step, string> = {
  source: "Source",
  upload: "Upload",
  connect: "Connect",
  analyzing: "Analyze",
  review: "Review",
  complete: "Done",
};

const LIVE_API_SOURCES: ImportSourceId[] = ["plaid", "truelayer"];

const SYNC_ROUTE: Partial<Record<ImportSourceId, string>> = {
  plaid: "/api/imports/plaid/sync",
  truelayer: "/api/imports/truelayer/sync",
};

const TRUELAYER_ERROR_MESSAGES: Record<string, string> = {
  denied: "Bank connection was cancelled.",
  invalid_state: "That connection link expired. Try connecting again.",
  connect_failed: "Couldn't finish connecting your bank. Try again.",
  no_accounts: "No accounts were shared. Reconnect and grant access to at least one account.",
  disabled: "TrueLayer import isn't available yet.",
  rate_limited: "Too many connection attempts recently. Try again in a bit.",
};

// The confirm endpoint's `source` enum (subscriptions.source's provenance
// tag) is distinct from the wizard's ImportSourceId (which providers the
// analyze route dispatches by) — see src/lib/imports/validation.ts.
const CONFIRM_SOURCE_MAP: Record<
  ImportSourceId,
  "csv_import" | "apple_import" | "google_play_import" | "plaid_import" | "truelayer_import"
> = {
  csv_bank: "csv_import",
  apple: "apple_import",
  google_play: "google_play_import",
  plaid: "plaid_import",
  truelayer: "truelayer_import",
};

function StepProgress({ step }: { step: Step }) {
  // "connect" (the live-API bank-link step) stands in for "upload" in the
  // progress bar — a source is either file-based or connect-based, never
  // both, so there's no dedicated dot for it.
  const currentIndex = STEP_ORDER.indexOf(step === "connect" ? "upload" : step);
  return (
    <div className="mb-6 flex items-center gap-2">
      {STEP_ORDER.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <Badge variant={i <= currentIndex ? "default" : "outline"}>{STEP_LABELS[s]}</Badge>
          {i < STEP_ORDER.length - 1 ? <div className="h-px w-6 bg-border" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

export function ImportCenterPage({
  plaidEnabled = false,
  trueLayerEnabled = false,
}: {
  plaidEnabled?: boolean;
  trueLayerEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<ImportSourceId | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedSubscription[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [skippedRowCount, setSkippedRowCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [completedIgnoredCount, setCompletedIgnoredCount] = useState(0);
  const handledRedirect = useRef(false);

  function reset() {
    setStep("source");
    setSource(null);
    setUploadError(null);
    setConnectError(null);
    setDetected([]);
    setWarnings([]);
    setSkippedRowCount(0);
    setBusy(false);
    setImportedCount(0);
    setCompletedIgnoredCount(0);
  }

  async function runSync(sourceId: ImportSourceId) {
    const syncRoute = SYNC_ROUTE[sourceId];
    if (!syncRoute) return;
    setStep("analyzing");
    try {
      const res = await fetch(syncRoute, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setConnectError(data?.message ?? "Couldn't fetch your transactions. Try again.");
        setStep("connect");
        return;
      }
      setDetected(data.detected ?? []);
      setWarnings(data.warnings ?? []);
      setSkippedRowCount(data.skippedRowCount ?? 0);
      setStep("review");
    } catch {
      setConnectError("Network error. Try again.");
      setStep("connect");
    }
  }

  function connectFromTrueLayerRedirect() {
    setSource("truelayer");
    void runSync("truelayer");
  }

  // TrueLayer's OAuth flow is a full-page redirect (see
  // /api/imports/truelayer/authorize and .../callback), so it can't hand
  // results back via a fetch() response the way Plaid's in-page Link modal
  // does — it lands back here as a query param on a fresh page load
  // instead. Same pattern as CheckoutActivator picking up
  // ?checkout_session_id after Stripe's redirect.
  useEffect(() => {
    if (handledRedirect.current) return;
    const connected = searchParams.get("truelayer_connected");
    const error = searchParams.get("truelayer_error");
    if (!connected && !error) return;
    handledRedirect.current = true;

    const url = new URL(window.location.href);
    url.searchParams.delete("truelayer_connected");
    url.searchParams.delete("truelayer_error");
    router.replace((url.pathname + url.search) as Route);

    if (error) {
      toast.error(TRUELAYER_ERROR_MESSAGES[error] ?? "Couldn't connect your bank. Try again.");
      return;
    }

    // Deferred a tick rather than called synchronously in the effect body —
    // react-hooks/set-state-in-effect flags direct setState calls here, and
    // this genuinely is "subscribe to an external system (the URL), react
    // to it once it settles" rather than a render-time state derivation.
    queueMicrotask(connectFromTrueLayerRedirect);
    // runSync/connectFromTrueLayerRedirect are stable enough for this
    // one-shot redirect-landing effect — re-running it on every render
    // would refetch on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  function handleSelectSource(selected: ImportSourceId) {
    setSource(selected);
    setUploadError(null);
    setConnectError(null);
    setStep(LIVE_API_SOURCES.includes(selected) ? "connect" : "upload");
  }

  async function handleFileSelected(file: File) {
    if (!source) return;
    setUploadError(null);
    setStep("analyzing");

    try {
      const formData = new FormData();
      formData.append("source", source);
      formData.append("file", file);
      const res = await fetch("/api/imports/analyze", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setUploadError(data?.message ?? "Couldn't analyze that file. Try again.");
        setStep("upload");
        return;
      }

      setDetected(data.detected ?? []);
      setWarnings(data.warnings ?? []);
      setSkippedRowCount(data.skippedRowCount ?? 0);
      setStep("review");
    } catch {
      setUploadError("Network error. Try again.");
      setStep("upload");
    }
  }

  async function handleConfirm(rows: SubscriptionFormValues[], ignoredCount: number) {
    if (!source) return;
    setBusy(true);
    try {
      const res = await fetch("/api/imports/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: CONFIRM_SOURCE_MAP[source], rows, ignoredCount }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.message ?? "Couldn't import these subscriptions. Try again.");
        return;
      }

      setImportedCount(data.subscriptions?.length ?? rows.length);
      setCompletedIgnoredCount(ignoredCount);
      setStep("complete");
      router.refresh();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StepProgress step={step} />
      <Card className="shadow-elevation-low">
        <CardHeader>
          <CardTitle className="font-heading text-2xl">
            {step === "source" && "Choose a source"}
            {step === "upload" && `Upload your ${source ? SOURCE_LABELS[source] : ""} file`}
            {step === "connect" && `Connect ${source ? SOURCE_LABELS[source] : ""}`}
            {step === "analyzing" && "Analyzing"}
            {step === "review" && "Review detected subscriptions"}
            {step === "complete" && "Import complete"}
          </CardTitle>
          <CardDescription>
            {step === "source" && "Pick where you'd like to import subscriptions from."}
            {step === "upload" && "We only read what's needed to detect subscriptions — the file itself is never stored."}
            {step === "connect" && "Nothing is fetched until you finish connecting your bank."}
            {step === "analyzing" && "This only takes a moment."}
            {step === "review" &&
              "Only high-confidence matches are pre-selected. Nothing is imported until you confirm."}
            {step === "complete" && "You can review everything on your subscriptions page."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeQuick}
            >
              {step === "source" ? (
                <SourcePicker
                  onSelect={handleSelectSource}
                  plaidEnabled={plaidEnabled}
                  trueLayerEnabled={trueLayerEnabled}
                />
              ) : null}
              {step === "upload" ? (
                <FileUploadStep onFileSelected={handleFileSelected} error={uploadError} />
              ) : null}
              {step === "connect" && (source === "plaid" || source === "truelayer") ? (
                <>
                  <ConnectBankStep
                    source={source}
                    onConnected={() => void runSync(source)}
                    onError={setConnectError}
                  />
                  {connectError ? (
                    <p role="alert" className="text-center text-sm text-destructive">
                      {connectError}
                    </p>
                  ) : null}
                </>
              ) : null}
              {step === "analyzing" ? <AnalyzingStep /> : null}
              {step === "review" ? (
                <>
                  {warnings.length > 0 ? (
                    <div className="mb-4 space-y-1 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                      {skippedRowCount > 0 ? (
                        <p>
                          {skippedRowCount} row{skippedRowCount === 1 ? "" : "s"} couldn&apos;t be read and{" "}
                          {skippedRowCount === 1 ? "was" : "were"} skipped.
                        </p>
                      ) : null}
                      {/* Non-skip warnings (e.g. "no currency column found;
                          assumed USD") previously had nowhere to render —
                          this block only ever showed the skipped-row count,
                          silently dropping every other warning message. */}
                      {Array.from(new Set(warnings)).map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {detected.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No recurring subscription payments were detected in this file.
                    </p>
                  ) : (
                    <ReviewTable
                      detected={detected}
                      sourceLabel={source ? SOURCE_LABELS[source] : ""}
                      busy={busy}
                      onConfirm={handleConfirm}
                    />
                  )}
                </>
              ) : null}
              {step === "complete" ? (
                <ImportCompleteStep
                  importedCount={importedCount}
                  ignoredCount={completedIgnoredCount}
                  onImportAnother={reset}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}
