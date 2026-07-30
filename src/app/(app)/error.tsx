"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-medium">Something went wrong</p>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this page. Try again, or come back in a moment.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
