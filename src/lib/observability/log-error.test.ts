import { describe, it, expect, vi, afterEach } from "vitest";
import { logServerError } from "./log-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logServerError", () => {
  it("logs a structured, parseable JSON line via console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("test.context", new Error("boom"), { userId: "u1" });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "error", context: "test.context", message: "boom", userId: "u1" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("logs a fixed message for a non-Error thrown value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("test.context", "not an error object");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.message).toBe("non-Error thrown");
  });

  it("reserved fields (level, context, message, timestamp) always win over same-named keys in meta", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("real.context", new Error("real message"), {
      level: "info" as unknown as string,
      context: "spoofed.context",
      message: "spoofed message",
      timestamp: "not-a-real-timestamp",
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.context).toBe("real.context");
    expect(parsed.message).toBe("real message");
    expect(parsed.timestamp).not.toBe("not-a-real-timestamp");
  });
});
