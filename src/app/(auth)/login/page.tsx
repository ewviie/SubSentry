"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/auth/password-field";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/turnstile-widget";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// See the identical constant on the signup page for why this is checked
// client-side too, not just left to the server to reject.
const CAPTCHA_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [loading, setLoading] = useState(false);
  const [resendCaptchaToken, setResendCaptchaToken] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const resendTurnstileRef = useRef<TurnstileWidgetHandle>(null);

  async function handleResend() {
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaToken: resendCaptchaToken }),
      });
    } catch {
      // Ignored — the endpoint's response is a fixed, generic message
      // regardless of outcome (anti-enumeration), so there's nothing more
      // specific to show even on success; a network failure just means the
      // user can try the button again.
    } finally {
      setResendState("sent");
      // Same single-use-token reasoning as the signup page — a fresh token
      // needs to be ready before any further attempt.
      setResendCaptchaToken(null);
      resendTurnstileRef.current?.reset();
    }
  }

  // Runs after the DOM commits, so this can't race the fields' still-true
  // disabled={loading} the way a synchronous focus() call inside
  // handleSubmit would (see the equivalent effect on the signup page).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendState("idle");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // The API deliberately never says whether the email or the password
        // was wrong (see login/route.ts's DUMMY_HASH comment — that's an
        // anti-enumeration measure, not an oversight), so there's no single
        // field to send focus to; the error banner is the right landing
        // spot for both keyboard and screen-reader users here.
        setError(data?.message ?? "Something went wrong. Try again.");
        setNeedsVerification(data?.error === "email_not_verified");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="font-heading text-2xl">Welcome back</CardTitle>
        <CardDescription>Log in to your SubSentry dashboard.</CardDescription>
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
          <PasswordField
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
            disabled={loading}
            ariaInvalid={Boolean(error)}
            ariaDescribedBy={error ? "auth-error" : undefined}
          />
          {error ? (
            <p ref={errorRef} id="auth-error" role="alert" tabIndex={-1} className="text-sm text-destructive outline-none">
              {error}
            </p>
          ) : null}
          {needsVerification ? (
            <div className="space-y-2">
              <TurnstileWidget
                ref={resendTurnstileRef}
                action="resend_verification"
                onVerify={setResendCaptchaToken}
                onExpire={() => setResendCaptchaToken(null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResend}
                disabled={resendState !== "idle" || (CAPTCHA_REQUIRED && !resendCaptchaToken)}
              >
                {resendState === "sent" ? "Verification email sent" : resendState === "sending" ? "Sending…" : "Resend verification email"}
              </Button>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Logging in…
              </>
            ) : (
              "Log in"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-foreground underline underline-offset-4">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
