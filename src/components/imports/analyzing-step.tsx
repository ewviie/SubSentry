import { Loader2 } from "lucide-react";

export function AnalyzingStep() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
      <p className="font-medium">Analyzing your file…</p>
      <p className="text-sm text-muted-foreground">Detecting recurring subscription payments.</p>
    </div>
  );
}
