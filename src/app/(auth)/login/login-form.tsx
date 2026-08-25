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

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Stays false through every normal login. The server only ever responds
  // with captcha_required once an account has already failed a couple of
  // logins in a row (see api/auth/login/route.ts). Progressive disclosure,
  // not a permanent fixture on this form: a first-time correct login never
  // sees a CAPTCHA at all.
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // Runs after the DOM commits, so this can't race the fields' still-true
  // disabled={loading} the way a synchronous focus() call inside
  // handleSubmit would (see the equivalent effect on the signup page).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captchaToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.error === "captcha_required") {
          setCaptchaRequired(true);
        }
        // The API deliberately never says whether the email or the password
        // was wrong (see login/route.ts's DUMMY_HASH comment, that's an
        // anti-enumeration measure, not an oversight), so there's no single
        // field to send focus to; the error banner is the right landing
        // spot for both keyboard and screen-reader users here.
        setError(data?.message ?? "Something went wrong. Try again.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
      // Same single-use-token reasoning as signup-form.tsx: every submit
      // needs a fresh token queued up before the next attempt.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
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
          <p className="text-right text-sm">
            <Link href="/forgot-password" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Forgot password?
            </Link>
          </p>
          {error ? (
            <p ref={errorRef} id="auth-error" role="alert" tabIndex={-1} className="text-sm text-destructive outline-none">
              {error}
            </p>
          ) : null}
          {captchaRequired ? (
            <TurnstileWidget ref={turnstileRef} action="login" onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loading || (captchaRequired && !captchaToken)}>
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
