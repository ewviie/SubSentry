import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// Symmetric, reversible encryption for live third-party access/refresh
// tokens (Plaid, TrueLayer) that must be decryptable to actually call those
// APIs later — unlike src/lib/auth/session.ts's one-way session token hash,
// which only ever needs comparison, never recovery. AES-256-GCM: a 12-byte
// random IV per call (never reused under a single key) plus a 16-byte auth
// tag, so tampering with stored ciphertext fails loudly at decrypt time
// instead of silently returning garbage.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        "and set it in .env before connecting a bank account.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes of base64.");
  }
  return key;
}

// Only reflects whether the key is present/well-formed — callers use this
// to decide whether to show a bank-connection feature at all, the same
// "leave unset and the button stays hidden" pattern already established
// for STRIPE_SECRET_KEY (see src/lib/billing/plan.ts).
export function isTokenEncryptionConfigured(): boolean {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

// Output layout: iv (12 bytes) || authTag (16 bytes) || ciphertext, all
// base64-encoded together as one opaque string — the only shape callers
// need to store in a single `text` column.
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  // Below this length there's no room for a full IV + auth tag, let alone
  // any ciphertext — reject up front with a clear error instead of letting
  // subarray() silently hand createDecipheriv a truncated/empty IV, which
  // fails deep inside node:crypto with a much less legible message.
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Stored token ciphertext is malformed or truncated.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
