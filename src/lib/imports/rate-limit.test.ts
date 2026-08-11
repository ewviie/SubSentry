import { describe, it, expect } from "vitest";
import { checkBankConnectRateLimit, checkDisconnectRateLimit } from "./rate-limit";

// Regression coverage for the disconnect-vs-connect rate-limit separation:
// before this, disconnect shared checkBankConnectRateLimit with
// authorize/exchange/sync, so a user who'd already exhausted their connect
// budget could be temporarily unable to disconnect their own already-linked
// account — the opposite of what a self-service revocation action should
// allow. checkDisconnectRateLimit must be a genuinely separate bucket, not
// a re-export or a shared instance.
describe("checkDisconnectRateLimit is independent of checkBankConnectRateLimit", () => {
  it("disconnect still allows a call after the connect limiter for the same user is exhausted", () => {
    const userId = `rate-limit-test-user-${Date.now()}-${Math.random()}`;

    // Exhaust the connect limiter entirely for this user.
    let connectResult;
    do {
      connectResult = checkBankConnectRateLimit(userId);
    } while (connectResult.allowed);
    expect(connectResult.allowed).toBe(false);

    // Disconnect must still work — it's a different bucket with its own
    // budget, not gated by the connect limiter's exhaustion.
    expect(checkDisconnectRateLimit(userId).allowed).toBe(true);
  });

  it("is a more generous ceiling than the connect limiter", () => {
    const connectUser = `rate-limit-test-connect-${Date.now()}-${Math.random()}`;
    const disconnectUser = `rate-limit-test-disconnect-${Date.now()}-${Math.random()}`;

    let connectAllowedCount = 0;
    while (checkBankConnectRateLimit(connectUser).allowed) connectAllowedCount++;

    let disconnectAllowedCount = 0;
    while (checkDisconnectRateLimit(disconnectUser).allowed) disconnectAllowedCount++;

    expect(disconnectAllowedCount).toBeGreaterThan(connectAllowedCount);
  });

  it("still enforces a real ceiling — disconnect is not unbounded", () => {
    const userId = `rate-limit-test-bounded-${Date.now()}-${Math.random()}`;
    let result;
    let calls = 0;
    do {
      result = checkDisconnectRateLimit(userId);
      calls++;
    } while (result.allowed && calls < 1000);
    expect(result.allowed).toBe(false);
    expect(calls).toBeLessThan(1000);
  });
});
