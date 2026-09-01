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
// as the unsubscribe action itself (api/renewal-reminders/unsubscribe and
// api/notifications/digest/unsubscribe both authorize via the link's own
// token, never a session).
//
// Retention pass: `kind` distinguishes which email this link came from
// (renewal reminders vs the weekly digest) so the copy tells the truth
// about what was actually turned off, rather than a generic "reminders"
// wording that would misdescribe a digest-unsubscribe. Defaults to the
// original "renewal reminders" copy when absent — every unsubscribe link
// this app has ever sent before this pass omits `kind` and must keep
// resolving correctly.
type UnsubscribeKind = "renewals" | "digest";

const COPY: Record<UnsubscribeKind, { title: string; success: string; failure: string }> = {
  renewals: {
    title: "Renewal reminders turned off",
    success: "You won't get any more renewal-reminder emails. You can turn them back on anytime from Settings.",
    failure: "This unsubscribe link couldn't be verified. If you're still getting reminders you don't want, you can turn them off from Settings instead.",
  },
  digest: {
    title: "Weekly digest turned off",
    success: "You won't get any more weekly-digest emails. You can turn it back on anytime from Settings.",
    failure: "This unsubscribe link couldn't be verified. If you're still getting the weekly digest and don't want it, you can turn it off from Settings instead.",
  },
};

function resolveKind(kind: string | undefined): UnsubscribeKind {
  return kind === "digest" ? "digest" : "renewals";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}): Promise<Metadata> {
  const { kind } = await searchParams;
  return { title: COPY[resolveKind(kind)].title, robots: { index: false, follow: false } };
}

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; kind?: string }>;
}) {
  const { ok, kind } = await searchParams;
  const success = ok === "1";
  const copy = COPY[resolveKind(kind)];

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
              {success ? copy.title : "Link invalid or expired"}
            </CardTitle>
            <CardDescription>{success ? copy.success : copy.failure}</CardDescription>
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
