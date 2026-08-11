"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

// TurnstileWidget itself renders nothing when this is unset (see its own
// file), but the submit button needs to know whether to wait on a token at
// all — without this, a captcha-configured deployment would let the form
// submit before the widget produces a token, and an unconfigured one would
// otherwise permanently disable the button waiting for a token that will
// never arrive.
const CAPTCHA_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

type FormField = "name" | "email" | "password";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<FormField | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // Runs after the fields' disabled={loading} attribute has actually
  // cleared from the DOM — calling .focus() synchronously inside
  // handleSubmit races that: loading is still true (fields still disabled)
  // at that point in the same tick, so a disabled input silently swallows
  // the focus call. An effect keyed on the error only fires post-commit.
  useEffect(() => {
    if (!error) return;
    const target =
      errorField === "name" ? nameRef.current
      : errorField === "email" ? emailRef.current
      : errorField === "password" ? passwordRef.current
      : errorRef.current;
    target?.focus();
  }, [error, errorField]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined, captchaToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const field: FormField | null =
          data?.field === "name" || data?.field === "email" || data?.field === "password"
            ? data.field
            : null;
        setError(data?.message ?? "Something went wrong. Try again.");
        setErrorField(field);
        return;
      }

      // Signup creates a session directly now (no email-verification step
      // in the active flow — see api/auth/signup/route.ts's comment), so
      // this lands the user straight in the app, the same way login does.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setErrorField(null);
    } finally {
      setLoading(false);
      // Turnstile tokens are single-use — Cloudflare rejects a second
      // verification attempt with the same token, so every submit
      // (successful or not) needs a fresh one queued up before the next
      // attempt, not just after a captcha-specific failure.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="font-heading text-2xl">Create your account</CardTitle>
        <CardDescription>Start tracking what you&apos;re actually paying for.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              ref={nameRef}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              aria-invalid={errorField === "name"}
              aria-describedby={errorField === "name" ? "auth-error" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              aria-invalid={errorField === "email"}
              aria-describedby={errorField === "email" ? "auth-error" : undefined}
            />
          </div>
          <PasswordField
            ref={passwordRef}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={setPassword}
            disabled={loading}
            ariaInvalid={errorField === "password"}
            ariaDescribedBy={errorField === "password" ? "auth-error password-hint" : "password-hint"}
            hint={
              <p id="password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            }
          />
          {error ? (
            <p ref={errorRef} id="auth-error" role="alert" tabIndex={-1} className="text-sm text-destructive outline-none">
              {error}
            </p>
          ) : null}
          {/* Not a flex row: an icon + running text that includes an inline
              <Link> used to sit in a `flex items-start` container, which
              made each text run and the Link its own flex item — with no
              flex-wrap, that squeezed the Link's own box down and broke
              "Terms of Service" across three separate lines even with room
              to spare beside it. An inline-block icon nudged onto the text
              baseline flows with the paragraph like a normal leading
              character instead, so the whole line (including the Link)
              wraps as ordinary text. */}
          <p className="text-xs text-muted-foreground">
            <Sparkles className="mr-1.5 inline-block size-3.5 -translate-y-px align-middle text-ai" aria-hidden="true" />
            SubSentry uses AI (Anthropic&apos;s Claude) to power optional features like quick-add and AI
            insight summaries — see our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
              Terms of Service
            </Link>{" "}
            for details.
          </p>
          <TurnstileWidget ref={turnstileRef} action="signup" onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="agree-terms"
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
              disabled={loading}
              className="mt-0.5"
              aria-describedby="agree-terms-label"
            />
            <Label htmlFor="agree-terms" id="agree-terms-label" className="text-xs font-normal text-muted-foreground">
              I agree to the{" "}
              <Link href="/terms" target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/privacy" target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </Label>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || (CAPTCHA_REQUIRED && !captchaToken) || !agreedToTerms}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
