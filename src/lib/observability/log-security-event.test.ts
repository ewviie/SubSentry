import { describe, it, expect, vi, afterEach } from "vitest";
import { logSecurityEvent } from "./log-security-event";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logSecurityEvent", () => {
  it("logs a structured, parseable JSON line via console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSecurityEvent("login_failed", { ip: "1.2.3.4", email: "user@example.com" });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "security", event: "login_failed", ip: "1.2.3.4", email: "user@example.com" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("never includes a field that isn't explicitly passed in meta", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSecurityEvent("csrf_rejected", { path: "/api/auth/logout" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Object.keys(parsed).sort()).toEqual(["event", "level", "path", "timestamp"]);
  });

  it("reserved fields (level, event, timestamp) always win over same-named keys in meta", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No current call site passes these keys, but a future one could, and
    // meta's shape is caller-controlled — this proves the log's own
    // claimed severity/event type can't be spoofed either way.
    logSecurityEvent("login_failed", {
      level: "info" as unknown as string,
      event: "not_login_failed",
      timestamp: "not-a-real-timestamp",
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("security");
    expect(parsed.event).toBe("login_failed");
    expect(parsed.timestamp).not.toBe("not-a-real-timestamp");
  });
});
