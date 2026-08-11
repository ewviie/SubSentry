"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "verifying" | "success" | "error";

export function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      // Deferred a tick — react-hooks/set-state-in-effect flags a direct
      // setState call here, same pattern already used for the TrueLayer
      // redirect-landing effect in import-center-page.tsx.
      queueMicrotask(() => {
        setStatus("error");
        setMessage("This verification link is missing its token.");
      });
      return;
    }

    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (cancelled) return;
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setStatus("error");
          setMessage(data?.message ?? "Couldn't verify your email. Try again.");
          return;
        }
        setStatus("success");
        redirectTimer = setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1200);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setMessage("Network error. Try again.");
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(redirectTimer);
    };
    // Runs once per mount against the token in the URL at load time —
    // re-running on searchParams identity churn would re-consume an
    // already-used token and always fail the second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <div
          className={
            status === "success"
              ? "flex size-10 items-center justify-center rounded-full bg-emerald-muted text-emerald"
              : status === "error"
                ? "flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                : "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          {status === "verifying" ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {status === "success" ? <CheckCircle2 className="size-5" aria-hidden="true" /> : null}
          {status === "error" ? <XCircle className="size-5" aria-hidden="true" /> : null}
        </div>
        <CardTitle as="h1" className="font-heading mt-3 text-2xl">
          {status === "verifying" && "Verifying your email…"}
          {status === "success" && "Email verified"}
          {status === "error" && "Verification failed"}
        </CardTitle>
        <CardDescription>
          {status === "verifying" && "Just a moment."}
          {status === "success" && "Taking you to your dashboard…"}
          {status === "error" && message}
        </CardDescription>
      </CardHeader>
      {status === "error" ? (
        <CardFooter>
          <Button render={<Link href="/login" />} nativeButton={false}>
            Back to log in
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
