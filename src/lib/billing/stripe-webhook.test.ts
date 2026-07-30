import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyStripeSignature } from "./stripe-webhook";

const secret = "whsec_test_secret";

function signPayload(payload: string, timestamp: number, withSecret = secret): string {
  const signature = createHmac("sha256", withSecret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const header = signPayload(payload, Math.floor(Date.now() / 1000));
    expect(verifyStripeSignature(payload, header, secret)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const header = signPayload(payload, Math.floor(Date.now() / 1000), "whsec_wrong");
    expect(verifyStripeSignature(payload, header, secret)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const header = signPayload(JSON.stringify({ id: "evt_1" }), Math.floor(Date.now() / 1000));
    expect(verifyStripeSignature(JSON.stringify({ id: "evt_2" }), header, secret)).toBe(false);
  });

  it("rejects a stale timestamp outside the replay-protection tolerance", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 60 * 60;
    const header = signPayload(payload, staleTimestamp);
    expect(verifyStripeSignature(payload, header, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyStripeSignature("{}", null, secret)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(verifyStripeSignature("{}", "not-a-valid-header", secret)).toBe(false);
  });

  it("accepts a payload when the matching signature isn't the last v1 in the header (secret rotation)", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const timestamp = Math.floor(Date.now() / 1000);
    const wrongSig = createHmac("sha256", "whsec_old").update(`${timestamp}.${payload}`).digest("hex");
    const rightSig = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    // Right signature listed first, wrong one last — a Map keyed on "v1"
    // would keep only the last entry and incorrectly reject this.
    const header = `t=${timestamp},v1=${rightSig},v1=${wrongSig}`;
    expect(verifyStripeSignature(payload, header, secret)).toBe(true);
  });
});
