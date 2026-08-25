import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

// Deliberately outside the (auth) route group: that layout redirects any
// signed-in visitor straight to /dashboard before this content would ever
// render (see (auth)/layout.tsx), which would break the common case of a
// user clicking this link from their email while still logged in elsewhere
// in the same browser. This page works identically logged in or out, same
// as the unsubscribe action itself (api/renewal-reminders/unsubscribe
// authorizes via the link's own token, never a session).
export const metadata: Metadata = {
  title: "Renewal reminders turned off",
  robots: { index: false, follow: false },
};

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const success = ok === "1";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <div
              className={
                success
                  ? "flex size-10 items-center justify-center rounded-full bg-emerald-muted text-emerald"
                  : "flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              }
            >
              {success ? <CheckCircle2 className="size-5" aria-hidden="true" /> : <XCircle className="size-5" aria-hidden="true" />}
            </div>
            <CardTitle as="h1" className="font-heading mt-3 text-2xl">
              {success ? "Renewal reminders turned off" : "Link invalid or expired"}
            </CardTitle>
            <CardDescription>
              {success
                ? "You won't get any more renewal-reminder emails. You can turn them back on anytime from Settings."
                : "This unsubscribe link couldn't be verified. If you're still getting reminders you don't want, you can turn them off from Settings instead."}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button render={<Link href="/settings" />} nativeButton={false}>
              Go to Settings
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
