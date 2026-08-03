"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeQuick } from "@/lib/motion";
import { SourcePicker, SOURCE_LABELS } from "./source-picker";
import { FileUploadStep } from "./file-upload-step";
import { AnalyzingStep } from "./analyzing-step";
import { ReviewTable } from "./review-table";
import { ImportCompleteStep } from "./import-complete-step";
import type { ImportSourceId } from "@/lib/imports/provider";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

type Step = "source" | "upload" | "analyzing" | "review" | "complete";

const STEP_ORDER: Step[] = ["source", "upload", "analyzing", "review", "complete"];
const STEP_LABELS: Record<Step, string> = {
  source: "Source",
  upload: "Upload",
  analyzing: "Analyze",
  review: "Review",
  complete: "Done",
};

// The confirm endpoint's `source` enum (subscriptions.source's provenance
// tag) is distinct from the wizard's ImportSourceId (which providers the
// analyze route dispatches by) — see src/lib/imports/validation.ts.
const CONFIRM_SOURCE_MAP: Record<ImportSourceId, "csv_import" | "apple_import" | "google_play_import"> = {
  csv_bank: "csv_import",
  apple: "apple_import",
  google_play: "google_play_import",
};

function StepProgress({ step }: { step: Step }) {
  const currentIndex = STEP_ORDER.indexOf(step);
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

export function ImportCenterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<ImportSourceId | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedSubscription[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [skippedRowCount, setSkippedRowCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [completedIgnoredCount, setCompletedIgnoredCount] = useState(0);

  function reset() {
    setStep("source");
    setSource(null);
    setUploadError(null);
    setDetected([]);
    setWarnings([]);
    setSkippedRowCount(0);
    setBusy(false);
    setImportedCount(0);
    setCompletedIgnoredCount(0);
  }

  function handleSelectSource(selected: ImportSourceId) {
    setSource(selected);
    setUploadError(null);
    setStep("upload");
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
            {step === "analyzing" && "Analyzing"}
            {step === "review" && "Review detected subscriptions"}
            {step === "complete" && "Import complete"}
          </CardTitle>
          <CardDescription>
            {step === "source" && "Pick where you'd like to import subscriptions from."}
            {step === "upload" && "We only read what's needed to detect subscriptions — the file itself is never stored."}
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
              {step === "source" ? <SourcePicker onSelect={handleSelectSource} /> : null}
              {step === "upload" ? (
                <FileUploadStep onFileSelected={handleFileSelected} error={uploadError} />
              ) : null}
              {step === "analyzing" ? <AnalyzingStep /> : null}
              {step === "review" ? (
                <>
                  {warnings.length > 0 ? (
                    <div className="mb-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                      {skippedRowCount > 0 ? (
                        <p>
                          {skippedRowCount} row{skippedRowCount === 1 ? "" : "s"} couldn&apos;t be read and{" "}
                          {skippedRowCount === 1 ? "was" : "were"} skipped.
                        </p>
                      ) : null}
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
