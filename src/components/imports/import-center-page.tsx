"use client";

import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Search } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { fadeQuick } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { sumMonthlyCentsIfSingleCurrency } from "@/lib/subscriptions/money";
import { SourcePicker, SOURCE_LABELS } from "./source-picker";
import { FileUploadStep } from "./file-upload-step";
import { ConnectBankStep } from "./connect-bank-step";
import { ConnectEmailStep } from "./connect-email-step";
import { AnalyzingStep } from "./analyzing-step";
import { RevealStep } from "./reveal-step";
import { ReviewTable } from "./review-table";
import { ImportCompleteStep } from "./import-complete-step";
import type { ImportSourceId } from "@/lib/imports/provider";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

type Step = "source" | "upload" | "connect" | "analyzing" | "reveal" | "review" | "complete";

const STEP_ORDER: Step[] = ["source", "upload", "analyzing", "review", "complete"];
const STEP_LABELS: Record<Step, string> = {
  source: "Source",
  upload: "Upload",
  connect: "Connect",
  analyzing: "Analyze",
  reveal: "Analyze",
  review: "Review",
  complete: "Done",
};

const LIVE_API_SOURCES: ImportSourceId[] = ["plaid", "truelayer", "gmail"];

const SYNC_ROUTE: Partial<Record<ImportSourceId, string>> = {
  plaid: "/api/imports/plaid/sync",
  truelayer: "/api/imports/truelayer/sync",
  gmail: "/api/imports/gmail/sync",
};

const TRUELAYER_ERROR_MESSAGES: Record<string, string> = {
  denied: "Bank connection was cancelled.",
  invalid_state: "That connection link expired. Try connecting again.",
  connect_failed: "Couldn't finish connecting your bank. Try again.",
  no_accounts: "No accounts were shared. Reconnect and grant access to at least one account.",
  disabled: "TrueLayer import isn't available yet.",
  rate_limited: "Too many connection attempts recently. Try again in a bit.",
};

const GMAIL_ERROR_MESSAGES: Record<string, string> = {
  denied: "Google connection was cancelled.",
  invalid_state: "That connection link expired. Try connecting again.",
  connect_failed: "Couldn't finish connecting your Google account. Try again.",
  disabled: "Google import isn't available yet.",
  rate_limited: "Too many connection attempts recently. Try again in a bit.",
};

// The confirm endpoint's `source` enum (subscriptions.source's provenance
// tag) is distinct from the wizard's ImportSourceId (which providers the
// analyze route dispatches by). See src/lib/imports/validation.ts.
const CONFIRM_SOURCE_MAP: Record<
  ImportSourceId,
  "csv_import" | "apple_import" | "google_play_import" | "plaid_import" | "truelayer_import" | "gmail_import"
> = {
  csv_bank: "csv_import",
  apple: "apple_import",
  google_play: "google_play_import",
  plaid: "plaid_import",
  truelayer: "truelayer_import",
  gmail: "gmail_import",
};

// Numbered-circle/check stepper (Stripe-checkout anatomy: circle + label +
// connecting line, active/completed/inactive states), adapted from the
// 21st.dev Stepper primitive's visual language, driven directly by the
// wizard's own Step state rather than that component's generic
// context-provider API, which this single-owner state doesn't need.
function StepProgress({ step }: { step: Step }) {
  // "connect" stands in for "upload" in the progress bar (a source is
  // either file-based or connect-based, never both), and "reveal" stands in
  // for "analyzing" (it's the tail end of the same wait, not a new stage
  // worth its own dot), neither gets a dedicated position.
  const mapped = step === "connect" ? "upload" : step === "reveal" ? "analyzing" : step;
  const currentIndex = STEP_ORDER.indexOf(mapped);
  return (
    <ol className="mb-6 flex items-center">
      {STEP_ORDER.map((s, i) => {
        const completed = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li
            key={s}
            aria-current={active ? "step" : undefined}
            className="flex flex-1 items-center last:flex-none"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  completed && "bg-primary text-primary-foreground",
                  active && "bg-primary/15 text-primary ring-1 ring-primary",
                  !completed && !active && "bg-muted text-muted-foreground",
                )}
              >
                {completed ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              {/* Labels hide below sm: 5 circle+label+connector groups
                  don't fit a phone-width screen without either wrapping
                  (breaks the horizontal progress metaphor) or overflowing
                  (cut off "Done" entirely, a real bug this pass caught).
                  The circles/connectors alone still show real progress;
                  the current step's name is announced via aria-current
                  plus the sr-only text below instead of hidden entirely. */}
              <span className={cn("hidden text-sm font-medium sm:inline", active ? "text-foreground" : "text-muted-foreground")}>
                {STEP_LABELS[s]}
                {completed ? <span className="sr-only"> (completed)</span> : null}
              </span>
              {active ? <span className="sr-only sm:hidden">{STEP_LABELS[s]}</span> : null}
            </div>
            {i < STEP_ORDER.length - 1 ? (
              <div className={cn("mx-3 h-px flex-1 transition-colors", completed ? "bg-primary" : "bg-border")} aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ImportCenterPage({
  plaidEnabled = false,
  trueLayerEnabled = false,
  gmailEnabled = false,
  gmailConnectedEmail = null,
  gmailLastSyncedAt = null,
}: {
  plaidEnabled?: boolean;
  trueLayerEnabled?: boolean;
  gmailEnabled?: boolean;
  gmailConnectedEmail?: string | null;
  gmailLastSyncedAt?: string | null;
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
  // null whenever the confirmed batch spans more than one currency, see
  // sumMonthlyCentsIfSingleCurrency's own comment in lib/subscriptions/money.ts.
  const [importedTotal, setImportedTotal] = useState<{ totalMonthlyCents: number; currency: string } | null>(null);
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
    setImportedTotal(null);
  }

  // Recovery action for a zero-result Review step, narrower than reset():
  // keeps the already-chosen source (there's no reason to make someone
  // re-pick "Bank CSV" just because their first file didn't have anything
  // recurring in it) and only clears the detection output. For a file-based
  // source this lands back on the same upload dropzone; for a live-API
  // source (no file to retry) it lands back on the connect/sync screen,
  // which already offers its own "Sync now" retry.
  function tryAgain() {
    setStep(source && LIVE_API_SOURCES.includes(source) ? "connect" : "upload");
    setUploadError(null);
    setConnectError(null);
    setDetected([]);
    setWarnings([]);
    setSkippedRowCount(0);
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
      // Skip the reveal beat when there's nothing to reveal: "0 charges
      // found, $0.00/mo!" isn't a payoff, it's an anti-climax. "review"
      // already renders its own "nothing detected" message for this case.
      setStep((data.detected ?? []).length > 0 ? "reveal" : "review");
    } catch {
      setConnectError("Network error. Try again.");
      setStep("connect");
    }
  }

  function connectFromTrueLayerRedirect() {
    setSource("truelayer");
    void runSync("truelayer");
  }

  function connectFromGmailRedirect() {
    setSource("gmail");
    void runSync("gmail");
  }

  // TrueLayer's OAuth flow is a full-page redirect (see
  // /api/imports/truelayer/authorize and .../callback), so it can't hand
  // results back via a fetch() response the way Plaid's in-page Link modal
  // does. It lands back here as a query param on a fresh page load
  // instead. Same pattern as CheckoutActivator picking up
  // ?checkout_session_id after Stripe's redirect. Gmail's OAuth flow is
  // architecturally identical (see /api/imports/gmail/authorize
  // and .../callback), so it lands here the same way.
  useEffect(() => {
    if (handledRedirect.current) return;
    const trueLayerConnected = searchParams.get("truelayer_connected");
    const trueLayerError = searchParams.get("truelayer_error");
    const gmailConnected = searchParams.get("gmail_connected");
    const gmailError = searchParams.get("gmail_error");
    if (!trueLayerConnected && !trueLayerError && !gmailConnected && !gmailError) return;
    handledRedirect.current = true;

    const url = new URL(window.location.href);
    url.searchParams.delete("truelayer_connected");
    url.searchParams.delete("truelayer_error");
    url.searchParams.delete("gmail_connected");
    url.searchParams.delete("gmail_error");
    router.replace((url.pathname + url.search) as Route);

    if (trueLayerError) {
      toast.error(TRUELAYER_ERROR_MESSAGES[trueLayerError] ?? "Couldn't connect your bank. Try again.");
      return;
    }
    if (gmailError) {
      toast.error(GMAIL_ERROR_MESSAGES[gmailError] ?? "Couldn't connect your Google account. Try again.");
      return;
    }

    // Deferred a tick rather than called synchronously in the effect body:
    // react-hooks/set-state-in-effect flags direct setState calls here, and
    // this genuinely is "subscribe to an external system (the URL), react
    // to it once it settles" rather than a render-time state derivation.
    if (trueLayerConnected) queueMicrotask(connectFromTrueLayerRedirect);
    if (gmailConnected) queueMicrotask(connectFromGmailRedirect);
    // runSync/connectFrom*Redirect are stable enough for this one-shot
    // redirect-landing effect: re-running it on every render would refetch
    // on unrelated re-renders.
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
      setStep((data.detected ?? []).length > 0 ? "reveal" : "review");
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
      // From the rows actually submitted, not the server response: same
      // shape sumMonthlyCentsIfSingleCurrency already expects, and this is
      // exactly what was just confirmed (the server echoes it back
      // 1:1 on success, so there's no reason to wait for/re-derive from
      // data.subscriptions).
      setImportedTotal(sumMonthlyCentsIfSingleCurrency(rows));
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
            {step === "source" && "Where should we look?"}
            {step === "upload" && `Upload your ${source ? SOURCE_LABELS[source] : ""} file`}
            {step === "connect" && `Connect ${source ? SOURCE_LABELS[source] : ""}`}
            {step === "analyzing" && "Analyzing"}
            {step === "reveal" && "Here's what we found"}
            {step === "review" && "Review detected subscriptions"}
            {step === "complete" && "Import complete"}
          </CardTitle>
          <CardDescription>
            {step === "source" && "Pick where SubSentry should look for your subscriptions."}
            {step === "upload" && "We only read what's needed to detect subscriptions. The file itself is never stored."}
            {step === "connect" && source === "gmail" && "Nothing is scanned until you finish connecting your Google account."}
            {step === "connect" && source !== "gmail" && "Nothing is fetched until you finish connecting your bank."}
            {step === "analyzing" && "This only takes a moment."}
            {step === "reveal" && "Nothing has been added yet. You'll confirm each one on the next screen."}
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
                  gmailEnabled={gmailEnabled}
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
              {step === "connect" && source === "gmail" ? (
                <>
                  <ConnectEmailStep
                    connectedEmail={gmailConnectedEmail}
                    lastSyncedAt={gmailLastSyncedAt}
                    onSync={() => void runSync("gmail")}
                    onDisconnected={reset}
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
              {step === "reveal" ? <RevealStep detected={detected} onContinue={() => setStep("review")} /> : null}
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
                          assumed USD") previously had nowhere to render:
                          this block only ever showed the skipped-row count,
                          silently dropping every other warning message. */}
                      {Array.from(new Set(warnings)).map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {detected.length === 0 ? (
                    <EmptyState
                      icon={Search}
                      title="No recurring subscriptions detected"
                      description={
                        source && LIVE_API_SOURCES.includes(source)
                          ? "We didn't find any charges that repeat often enough to look like a subscription."
                          : "That file didn't have any charges that repeat often enough to look like a subscription."
                      }
                      action={
                        <Button variant="outline" size="sm" onClick={tryAgain}>
                          {source && LIVE_API_SOURCES.includes(source) ? "Try again" : "Try a different file"}
                        </Button>
                      }
                    />
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
                  total={importedTotal}
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
