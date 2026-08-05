import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ImportCompleteStep({
  importedCount,
  ignoredCount,
  onImportAnother,
}: {
  importedCount: number;
  ignoredCount: number;
  onImportAnother: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-emerald-muted text-emerald">
        <CheckCircle2 className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-heading text-xl font-semibold">
          Imported {importedCount} subscription{importedCount === 1 ? "" : "s"}
        </p>
        <p className="text-sm text-muted-foreground">
          {ignoredCount > 0 ? `${ignoredCount} ignored.` : "Nothing was ignored."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button render={<Link href="/subscriptions" />} nativeButton={false}>
          View subscriptions
        </Button>
        <Button variant="outline" onClick={onImportAnother}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
