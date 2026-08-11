import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppSegmentNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-5" />
      </div>
      <h1 className="font-medium">Not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Button render={<Link href="/dashboard" />} nativeButton={false}>
        Back to dashboard
      </Button>
    </div>
  );
}
