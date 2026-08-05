import type { Page } from "@playwright/test";

// Runs fetch() *inside the page's own browser context* rather than via
// Playwright's page.request client. This matters here specifically:
// page.request is a separate Node-side HTTP client that does not apply
// Chromium's "localhost/127.0.0.1 counts as a secure context" exception the
// way a real browser tab does — the app's session cookie is Secure in a
// production build (`next start`, which is what these E2E tests run
// against), so page.request silently drops it and every call comes back
// 401, even for an already-logged-in browser context. Routing the request
// through the page's own fetch avoids that mismatch entirely.
export async function apiFetch(
  page: Page,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ url, init }) => {
      const res = await fetch(url, {
        method: init?.method ?? "GET",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    { url, init },
  );
}
