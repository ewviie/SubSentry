// Shared between middleware.ts (Edge runtime, cheap presence check only) and
// lib/auth/session.ts (Node runtime, authoritative DB-backed check) — see
// the two-layer route-protection pattern described there.
export const SESSION_COOKIE = "dbl_session";
