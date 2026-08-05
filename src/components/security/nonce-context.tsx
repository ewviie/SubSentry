"use client";

// Threads proxy.ts's per-request CSP nonce down to client components that
// need to load a script Next.js itself doesn't know about (Turnstile's
// widget — see turnstile-widget.tsx). Next.js auto-nonces its own
// framework-injected scripts; anything this app adds itself has to be
// nonced by hand, and a nonce set as a static build-time constant would
// defeat the point (proxy.ts mints a fresh one per request specifically so
// it can't be guessed/reused). React Context is the standard way to get a
// per-request server-only value (read via next/headers in a Server
// Component) down to a Client Component several layers below it without
// threading it through every component's props by hand.
import { createContext, useContext } from "react";

const NonceContext = createContext<string | null>(null);

export function NonceProvider({ nonce, children }: { nonce: string | null; children: React.ReactNode }) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
}

export function useNonce(): string | null {
  return useContext(NonceContext);
}
