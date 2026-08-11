// Validated NEXT_PUBLIC_APP_URL, shared by every call site that needs an
// absolute base URL (layout.tsx's metadataBase, absoluteUrl() below,
// sitemap.ts, robots.ts) — one place to decide "is this usable" instead of
// four independent `new URL(raw)` calls, each of which would throw
// uncaught on a malformed value (a typo'd scheme, a bare hostname with no
// protocol, etc.) and crash metadata generation for every page, since
// layout.tsx's generateMetadata runs on every render. Malformed input is
// treated the same as unset — silently omit, never fabricate or crash —
// consistent with this file's and sitemap.ts/robots.ts's existing "leave
// it out until a real, working domain exists" convention. env.ts's own
// startup check is where a malformed value gets surfaced loudly instead;
// this function's job is only to never let a bad value reach a render.
//
// Reads process.env.NEXT_PUBLIC_APP_URL *inside* the function body, not as
// a module-scope constant — verified empirically (against a real
// production build) that a module-scope read here produces `undefined` on
// every dynamically-rendered page (/, /login, /signup, /forgot-password,
// /subscription-tracker — anything that calls getSession(), which makes it
// dynamic), even with the env var genuinely set for the running process,
// while the exact same env var read fresh inside sitemap.ts's/robots.ts's
// own exported functions (which this mirrors) resolves correctly
// everywhere. Statically-generated pages (/terms, /privacy, /guides/...,
// /subscription-cost-calculator) happened to work with a module-scope read
// too — their metadata is committed to static HTML once, during `next
// build`, before whatever timing gap causes the dynamic-route case to miss
// it — which is exactly the kind of build-vs-runtime-timing divergence
// that makes a module-scope env read the wrong pattern here regardless.
export function getAppUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

// Absolute URL for a given path against the configured production domain —
// used everywhere page metadata needs a canonical/OG/Twitter URL. Returns
// undefined (never a fabricated domain) when NEXT_PUBLIC_APP_URL isn't set
// or isn't a valid http(s) URL, the same "leave it out" convention
// sitemap.ts/robots.ts already use.
//
// Also why this exists at all, rather than relying on Next's own
// metadataBase + relative-path convention (`alternates: { canonical:
// "/login" }`, resolved against the root layout's `metadataBase`): that
// convention inherits the exact same module-scope-timing gap getAppUrl()'s
// comment describes, since metadataBase itself is set from a per-call
// getAppUrl() read in layout.tsx. Computing the absolute URL here, per
// call, sidesteps it.
export function absoluteUrl(path: string): string | undefined {
  const appUrl = getAppUrl();
  if (!appUrl) return undefined;
  return new URL(path, appUrl).toString();
}
