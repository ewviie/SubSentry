"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/turnstile-widget";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Same reasoning as signup-form.tsx's identical constant: TurnstileWidget
// renders nothing when unconfigured, but the submit button still needs to
// know whether to wait on a token at all.
const CAPTCHA_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once true, stays true regardless of what's typed next — the API
  // response is always the same generic message (see the route's own
  // GENERIC_RESPONSE comment on why), so there's no real "success" vs
  // "failure" state to show here beyond a request error.
  const [submitted, setSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Something went wrong. Try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
      // Turnstile tokens are single-use — see signup-form.tsx's identical
      // reasoning.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-muted text-emerald">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <CardTitle as="h1" className="font-heading mt-3 text-2xl">
            Check your email
          </CardTitle>
          <CardDescription>If that email has an account, a reset link is on its way.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" render={<Link href="/login" />} nativeButton={false}>
            Back to log in
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="font-heading text-2xl">
          Forgot your password?
        </CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </div>
          {error ? (
            <p id="auth-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <TurnstileWidget
            ref={turnstileRef}
            action="forgot_password"
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loading || (CAPTCHA_REQUIRED && !captchaToken)}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
