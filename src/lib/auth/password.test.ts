import { describe, it, expect } from "vitest";
import { checkPasswordStrength } from "./password";

describe("checkPasswordStrength", () => {
  it("accepts a genuinely strong password", () => {
    expect(checkPasswordStrength("Tr0ub4dor&Zebra!", "user@example.com").ok).toBe(true);
  });

  it("rejects a common breached password, case-insensitively", () => {
    expect(checkPasswordStrength("Password123", "user@example.com").ok).toBe(false);
    expect(checkPasswordStrength("PASSWORD1", "user@example.com").ok).toBe(false);
  });

  it("rejects an all-same-character password", () => {
    expect(checkPasswordStrength("aaaaaaaa", "user@example.com").ok).toBe(false);
  });

  it("rejects an ascending sequential password", () => {
    expect(checkPasswordStrength("12345678", "user@example.com").ok).toBe(false);
    expect(checkPasswordStrength("abcdefgh", "user@example.com").ok).toBe(false);
  });

  it("rejects a descending sequential password", () => {
    expect(checkPasswordStrength("87654321", "user@example.com").ok).toBe(false);
  });

  it("rejects a non-sequential digits-only password", () => {
    // Not in the common list, not a repeated/sequential run — but still
    // only digits, so still limited to 10^n combinations.
    expect(checkPasswordStrength("48213976", "user@example.com").ok).toBe(false);
    expect(checkPasswordStrength("90275318142", "user@example.com").ok).toBe(false);
  });

  it("accepts a long digits-only string only when non-digit characters are mixed in", () => {
    expect(checkPasswordStrength("4821-3976!", "user@example.com").ok).toBe(true);
  });

  it("rejects a password containing the user's own email local-part", () => {
    expect(checkPasswordStrength("johnsmith99", "johnsmith@example.com").ok).toBe(false);
  });

  it("does not false-positive on a short email local-part inside an unrelated strong password", () => {
    // "abc" (3 chars) is below the 4-char minimum this check uses to avoid
    // an unreasonably short local-part matching by coincidence.
    const result = checkPasswordStrength("Xk9#mQ2vLpZ7abc", "abc@example.com");
    expect(result.ok).toBe(true);
  });

  it("returns a human-readable reason on rejection", () => {
    const result = checkPasswordStrength("password123", "user@example.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
