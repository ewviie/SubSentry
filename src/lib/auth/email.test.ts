import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isEmailSendingConfigured, sendVerificationEmail } from "./email";

// vi.mock calls are hoisted above imports by Vitest's transform, so the
// mocked module applies before ./email's own `import nodemailer from
// "nodemailer"` is evaluated. vi.hoisted() is the explicit escape hatch for
// referencing these from inside the mock factory (a plain outer const
// would otherwise trip Vitest's temporal-dead-zone hoisting check).
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransportMock(options) },
}));

// NODE_ENV is handled separately via vi.stubEnv/unstubAllEnvs below —
// @types/node marks it read-only, so a plain `process.env.NODE_ENV = ...`
// assignment (which works fine at runtime under Vitest) fails typecheck.
const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isEmailSendingConfigured", () => {
  it("is false when any required SMTP_* var is unset", () => {
    delete process.env.SMTP_HOST;
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@outlook.com";
    process.env.SMTP_PASSWORD = "pw";
    process.env.SMTP_FROM = "SubSentry <user@outlook.com>";
    expect(isEmailSendingConfigured()).toBe(false);
  });

  it("is true when all required SMTP_* vars are set", () => {
    process.env.SMTP_HOST = "smtp-mail.outlook.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@outlook.com";
    process.env.SMTP_PASSWORD = "pw";
    process.env.SMTP_FROM = "SubSentry <user@outlook.com>";
    expect(isEmailSendingConfigured()).toBe(true);
  });
});

describe("sendVerificationEmail — unconfigured (demo mode)", () => {
  it("logs the link and returns in non-production", async () => {
    delete process.env.SMTP_HOST;
    vi.stubEnv("NODE_ENV", "test");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("throws in production rather than logging a live verification link", async () => {
    delete process.env.SMTP_HOST;
    vi.stubEnv("NODE_ENV", "production");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/SMTP/);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("sendVerificationEmail — configured (SMTP via Nodemailer)", () => {
  beforeEach(() => {
    process.env.SMTP_HOST = "smtp-mail.outlook.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@outlook.com";
    process.env.SMTP_PASSWORD = "pw";
    process.env.SMTP_FROM = "SubSentry <user@outlook.com>";
  });

  it("succeeds on the first attempt, no retry", async () => {
    sendMailMock.mockResolvedValue({ messageId: "msg-1", accepted: ["user@example.com"], rejected: [] });

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("creates the transporter from SMTP_* env vars, with secure:false on port 587", async () => {
    sendMailMock.mockResolvedValue({ messageId: "msg-2", accepted: [], rejected: [] });

    await sendVerificationEmail("user@example.com", "raw-token");

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp-mail.outlook.com",
        port: 587,
        secure: false,
        auth: { user: "user@outlook.com", pass: "pw" },
      }),
    );
  });

  it("sends the expected copy, with the verification link in both the html and text bodies, from SMTP_FROM", async () => {
    sendMailMock.mockResolvedValue({ messageId: "msg-3", accepted: [], rejected: [] });

    await sendVerificationEmail("user@example.com", "raw-token");

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.from).toBe("SubSentry <user@outlook.com>");
    expect(mail.to).toBe("user@example.com");
    expect(mail.html).toContain("Thanks for creating a SubSentry account");
    expect(mail.html).toContain("Verify email address");
    expect(mail.html).toContain("Once your email has been verified");
    expect(mail.text).toContain("Thanks for creating a SubSentry account");
    expect(mail.html).toMatch(/href="http[^"]*\/verify-email\?token=raw-token"/);
    expect(mail.text).toContain("/verify-email?token=raw-token");
  });

  // Diagnostic logging (same reasoning this carried over from the prior
  // Resend implementation): a successful sendMail() only means the SMTP
  // server *accepted* the message, not that it reached the recipient's
  // inbox — logging the messageId lets a specific send be traced, and
  // logging the full SMTP failure (code/responseCode/response), not just
  // "it failed", is what actually distinguishes a bad password from a
  // rejected recipient from a timed-out connection.
  it("logs the message id on a successful send", async () => {
    sendMailMock.mockResolvedValue({ messageId: "msg-4", accepted: ["user@example.com"], rejected: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendVerificationEmail("user@example.com", "raw-token");

    const logged = logSpy.mock.calls.map((c) => c[0]).find((line) => String(line).includes("msg-4"));
    expect(logged).toBeDefined();
  });

  it("logs the SMTP failure's code/responseCode, not just that it failed", async () => {
    const error = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
    sendMailMock.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/Invalid login/);

    const logged = errorSpy.mock.calls.map((c) => c[0]).find((line) => String(line).includes("EAUTH"));
    expect(logged).toBeDefined();
  });

  it("does not retry EAUTH (bad credentials) — retrying can't fix a wrong password", async () => {
    const error = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
    sendMailMock.mockRejectedValue(error);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/Invalid login/);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("retries a 4xx SMTP response (temporary failure per RFC 5321) and succeeds on the second attempt", async () => {
    sendMailMock
      .mockRejectedValueOnce(Object.assign(new Error("Mailbox busy"), { responseCode: 450 }))
      .mockResolvedValueOnce({ messageId: "msg-5", accepted: [], rejected: [] });

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 5xx SMTP response (permanent failure per RFC 5321)", async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 }));

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/Mailbox unavailable/);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("retries a connection-level error (no SMTP response at all) and succeeds on a later attempt", async () => {
    sendMailMock
      .mockRejectedValueOnce(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce({ messageId: "msg-6", accepted: [], rejected: [] });

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries on a persistent 4xx", async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error("Mailbox busy"), { responseCode: 450 }));

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/Mailbox busy/);
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries on persistent connection errors", async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error("still down"), { code: "ECONNECTION" }));

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/still down/);
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });
});
