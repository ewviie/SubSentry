import { describe, it, expect } from "vitest";
import { comparePriority, summarizeTopChanges, SEVERITY_RANK } from "./ranking";

function candidate(overrides: Partial<{ title: string; body: string; severity: "warning" | "info"; impactCents: number | null }> = {}) {
  return {
    title: "Title",
    body: "Body",
    severity: "info" as const,
    impactCents: null,
    ...overrides,
  };
}

describe("comparePriority", () => {
  it("ranks warning above info regardless of impact", () => {
    const warning = candidate({ severity: "warning", impactCents: 1 });
    const info = candidate({ severity: "info", impactCents: 999_999 });
    expect(comparePriority(warning, info)).toBeLessThan(0); // warning sorts first
  });

  it("within the same severity, ranks higher impactCents first", () => {
    const small = candidate({ severity: "warning", impactCents: 100 });
    const big = candidate({ severity: "warning", impactCents: 5000 });
    expect(comparePriority(big, small)).toBeLessThan(0);
  });

  it("treats a null impactCents as 0 for the tiebreak", () => {
    const nullImpact = candidate({ severity: "info", impactCents: null });
    const positiveImpact = candidate({ severity: "info", impactCents: 1 });
    expect(comparePriority(positiveImpact, nullImpact)).toBeLessThan(0);
  });

  it("SEVERITY_RANK is the single source both digest.ts and notifications/queries.ts import", () => {
    expect(SEVERITY_RANK).toEqual({ warning: 1, info: 0 });
  });
});

describe("summarizeTopChanges", () => {
  it("0 candidates: returns null", () => {
    expect(summarizeTopChanges([])).toBeNull();
  });

  it("1 candidate: returns it as the primary, secondary null", () => {
    const only = candidate({ title: "Only thing", body: "Only body" });
    const result = summarizeTopChanges([only]);
    expect(result).toEqual({ title: "Only thing", body: "Only body", secondary: null });
  });

  it("2 candidates: composes both, ranked correctly", () => {
    const low = candidate({ title: "Low", body: "Low body", severity: "info", impactCents: 100 });
    const high = candidate({ title: "High", body: "High body", severity: "warning", impactCents: 200 });
    // Passed in low-first order — the function must still rank by priority,
    // not input order.
    const result = summarizeTopChanges([low, high]);
    expect(result).toEqual({
      title: "High",
      body: "High body",
      secondary: { title: "Low", body: "Low body" },
    });
  });

  it("more than 2 candidates: only the top 2 are ever reflected", () => {
    const items = [
      candidate({ title: "Third", severity: "info", impactCents: 10 }),
      candidate({ title: "First", severity: "warning", impactCents: 500 }),
      candidate({ title: "Second", severity: "warning", impactCents: 200 }),
      candidate({ title: "Fourth", severity: "info", impactCents: 5 }),
    ];
    const result = summarizeTopChanges(items);
    expect(result?.title).toBe("First");
    expect(result?.secondary?.title).toBe("Second");
  });

  it("deterministic ordering: exact ties (same severity, same impactCents) keep their original relative order, every call", () => {
    const items = [
      candidate({ title: "A", severity: "warning", impactCents: 300 }),
      candidate({ title: "B", severity: "warning", impactCents: 300 }),
    ];
    // Array.prototype.sort is a stable sort (ES2019+) — a genuine tie must
    // never flip order from run to run, or the digest/dashboard could show
    // a different "top item" for the exact same underlying data depending
    // on nothing more than sort implementation noise.
    for (let i = 0; i < 5; i++) {
      const result = summarizeTopChanges(items);
      expect(result?.title).toBe("A");
      expect(result?.secondary?.title).toBe("B");
    }
  });

  it("does not mutate the input array", () => {
    const items = [
      candidate({ title: "Low", severity: "info", impactCents: 1 }),
      candidate({ title: "High", severity: "warning", impactCents: 1 }),
    ];
    const copy = [...items];
    summarizeTopChanges(items);
    expect(items).toEqual(copy);
  });
});
