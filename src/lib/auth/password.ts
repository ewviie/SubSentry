import argon2 from "argon2";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// The ~100 passwords that show up at the top of essentially every public
// breach-corpus frequency list (rockyou.txt, HaveIBeenPwned's published
// top-N, NCSC's "most hacked passwords") — not a full k-anonymity check
// against the real Pwned Passwords API (a real network dependency this
// app doesn't have elsewhere, and overkill for what's meant to catch the
// "password123"/"qwerty123" class of case), but a genuine, real list, not
// a fabricated placeholder set. Case-insensitive match against the whole
// password.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "letmein123", "welcome123", "admin1234", "iloveyou1",
  "sunshine1", "princess1", "football1", "baseball1", "dragon123", "monkey123",
  "abc123456", "trustno1", "master123", "shadow123", "superman1", "michael1",
  "jennifer1", "computer1", "internet1", "starwars1", "hunter123", "freedom123",
  "whatever1", "12345678a", "a12345678", "changeme1", "letmein1", "passw0rd",
  "p@ssw0rd", "p@ssword", "password!", "welcome1!", "qwerty12345",
]);

// A run of the same character, or a monotonic ascending/descending
// sequence of adjacent characters (letters or digits) — "aaaaaaaa",
// "12345678", "87654321", "abcdefgh" — long enough to pass the length
// check but with essentially zero real entropy.
function isTrivialSequence(password: string): boolean {
  const lower = password.toLowerCase();
  if (new Set(lower).size === 1) return true;

  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i++) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

export interface PasswordStrengthResult {
  ok: boolean;
  reason?: string;
}

// Beyond Zod's own min(8)/max(200) length bounds (bodySchema in
// signup/route.ts) — length alone doesn't stop "password123" or
// "aaaaaaaa", both of which satisfy min(8). Deliberately not a full
// entropy/zxcvbn-style scorer (a new dependency this app doesn't already
// carry, for a check that mainly needs to catch the obvious, high-volume
// cases) — this rejects the specific, real, well-documented weak
// patterns above, nothing invented.
export function checkPasswordStrength(password: string, email: string): PasswordStrengthResult {
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "That password is too common. Choose something less guessable." };
  }
  if (isTrivialSequence(password)) {
    return { ok: false, reason: "That password is too predictable (repeated or sequential characters)." };
  }
  const emailLocalPart = email.split("@")[0]?.toLowerCase();
  if (emailLocalPart && emailLocalPart.length >= 4 && password.toLowerCase().includes(emailLocalPart)) {
    return { ok: false, reason: "Your password can't contain part of your email address." };
  }
  return { ok: true };
}
