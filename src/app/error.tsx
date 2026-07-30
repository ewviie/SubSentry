"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Catches errors from the (app) and (auth) layouts themselves (a segment's
// own error.tsx can't catch errors thrown by its own layout — those bubble
// up to the parent segment's boundary, which for both route groups is this
// root-level one), plus anything from app/page.tsx.
export default function RootSegmentError({
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-medium">Something went wrong</p>
      <p className="text-sm text-muted-foreground">
        Try again, or come back in a moment.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
