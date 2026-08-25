"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import Script from "next/script";
import { useTheme } from "next-themes";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useNonce } from "@/components/security/nonce-context";

// Cloudflare Turnstile. See src/lib/security/captcha.ts for why this
// provider was chosen over hCaptcha/reCAPTCHA. Rendered explicitly (not
// via the implicit data-sitekey auto-render) so this component has a real
// handle on the widget: resetting it after every submit attempt (tokens
// are single-use, a retry after a *different* failure, like "email
// already taken", would otherwise carry an already-spent token) and
// surfacing load/error states instead of a silent blank box.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          theme?: "light" | "dark" | "auto";
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export interface TurnstileWidgetHandle {
  // Called after every submit attempt (success or failure). See the
  // file-header comment on why a fresh token is needed before any retry.
  reset: () => void;
}

interface TurnstileWidgetProps {
  action: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

// Returns null (renders nothing) when CAPTCHA isn't configured, the same
// "absent env, feature quietly absent" convention as every other optional
// integration in this app. The signup/login pages don't need their own
// isCaptchaConfigured() check because of this; they just always render
// <TurnstileWidget>, and it's a no-op when unconfigured.
export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { action, onVerify, onExpire },
  ref,
) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const nonce = useNonce();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const containerId = useId();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }));

  function renderWidget() {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        // "auto" would ask the OS, independent of the app's own
        // light/dark toggle (next-themes). Explicit resolvedTheme keeps
        // the widget visually consistent with whatever the user actually
        // has the app set to, including a manual override away from
        // system preference.
        theme: resolvedTheme === "dark" ? "dark" : "light",
        callback: (token) => onVerify(token),
        "expired-callback": () => onExpire?.(),
        "error-callback": () => setStatus("error"),
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!siteKey) return;
    // The script may already be loaded and window.turnstile already
    // available (e.g. React StrictMode's double-invoke in dev, or this
    // component remounting). Render immediately rather than waiting on
    // next/script's onLoad, which only fires once per actual script load.
    if (window.turnstile) {
      renderWidget();
    }
    return () => {
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div className="space-y-2">
      <Script src={SCRIPT_SRC} nonce={nonce ?? undefined} strategy="afterInteractive" onLoad={renderWidget} onError={() => setStatus("error")} />
      {status === "loading" && (
        <div className="flex h-[65px] items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading verification…
        </div>
      )}
      {status === "error" && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          Couldn&apos;t load verification. Disable any content/script blocker for this site and refresh, or try again
          in a moment.
        </p>
      )}
      <div id={containerId} ref={containerRef} className={status === "ready" ? "" : "sr-only"} />
    </div>
  );
});
