"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/password-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "form" | "submitting" | "success" | "error";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setStatus("submitting");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("form");
        setError(data?.message ?? "Couldn't reset your password. Try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("form");
      setError("Network error. Try again.");
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="size-5" aria-hidden="true" />
          </div>
          <CardTitle as="h1" className="font-heading mt-3 text-2xl">
            Invalid reset link
          </CardTitle>
          <CardDescription>This link is missing its token. Request a new one.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button render={<Link href="/forgot-password" />} nativeButton={false}>
            Request a new link
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-muted text-emerald">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <CardTitle as="h1" className="font-heading mt-3 text-2xl">
            Password reset
          </CardTitle>
          {/* Deliberately no auto-login/redirect here. See
              api/auth/reset-password/route.ts's comment on why every
              existing session (including this one) was just revoked, and
              why signing back in with the new password is the safer,
              intentional next step rather than a silent auto-login. */}
          <CardDescription>Log in with your new password to continue.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button render={<Link href="/login" />} nativeButton={false}>
            Log in
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="font-heading text-2xl">
          Choose a new password
        </CardTitle>
        <CardDescription>Make it at least 8 characters and hard to guess.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <PasswordField
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={setPassword}
            disabled={status === "submitting"}
            ariaInvalid={Boolean(error)}
            ariaDescribedBy={error ? "auth-error password-hint" : "password-hint"}
            hint={
              <p id="password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            }
          />
          {error ? (
            <p ref={errorRef} id="auth-error" role="alert" tabIndex={-1} className="rounded-sm text-sm text-destructive outline-none focus-visible:ring-3 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={status === "submitting"}>
            {status === "submitting" ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Resetting…
              </>
            ) : (
              "Reset password"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
