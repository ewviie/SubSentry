import { describe, it, expect } from "vitest";
import { styleForDimensionStatus, joinLabels, worstKnownDimension } from "./insight-panels";
import type { HealthDimensionStatus, HealthDimensionResult } from "@/lib/insights-engine";

// This project has no React component-rendering test setup (see
// review-table.test.ts's own comment) — styleForDimensionStatus is a plain
// function, so it's tested directly here rather than introducing a new
// testing paradigm for one lookup.

// Regression (release-review finding #10): DIMENSION_STATUS_STYLE used to
// be typed as Record<string, ...>, not Record<HealthDimensionStatus, ...>,
// so TypeScript couldn't catch a HealthDimensionStatus value missing an
// entry at compile time, and the render call site had no runtime fallback
// either — a status reaching this lookup some way the type system couldn't
// see would throw on `style.dot`/`style.label` being undefined.
describe("styleForDimensionStatus", () => {
  it.each(["good", "watch", "attention", "unknown"] as const)(
    "returns a real dot/label pair for every known status (%s)",
    (status) => {
      const style = styleForDimensionStatus(status);
      expect(style.dot).toBeTruthy();
      expect(style.label).toBeTruthy();
    },
  );

  it("falls back to the neutral 'unknown' style instead of throwing for a value the type system didn't catch", () => {
    // Simulates exactly the gap the old Record<string, ...> typing left
    // open — a status that reaches here some way TypeScript couldn't
    // verify (e.g. deserialized from a server/client boundary).
    const unexpectedStatus = "archived" as unknown as HealthDimensionStatus;
    const style = styleForDimensionStatus(unexpectedStatus);
    expect(style).toEqual(styleForDimensionStatus("unknown"));
  });
});

// UI audit finding #4: ScoreBreakdownCard collapses every "unknown" health
// dimension into one row instead of repeating the same generic sentence
// once per dimension — joinLabels formats that row's dimension-name list.
describe("joinLabels", () => {
  it("returns the single label unchanged for one item", () => {
    expect(joinLabels(["Growth"])).toBe("Growth");
  });

  it("joins two labels with 'and', no comma", () => {
    expect(joinLabels(["Growth", "Renewals"])).toBe("Growth and Renewals");
  });

  it("joins three or more labels with commas and a trailing 'and'", () => {
    expect(joinLabels(["Spending", "Growth", "Renewals"])).toBe("Spending, Growth, and Renewals");
  });

  it("returns an empty string for an empty list rather than throwing", () => {
    expect(joinLabels([])).toBe("");
  });
});

// Monetization Council P0: a free-plan caller sees this single dimension's
// own summary instead of ScoreBreakdownCard's full per-dimension list —
// worstKnownDimension is a plain, pure function (same "no component-test
// harness needed" reasoning as the two above), so it's tested directly
// rather than through a rendered card.
describe("worstKnownDimension", () => {
  function dim(overrides: Partial<HealthDimensionResult>): HealthDimensionResult {
    return {
      key: "spending",
      label: "Spending",
      score: 100,
      status: "good",
      summary: "",
      recommendedAction: null,
      breakdown: [],
      ...overrides,
    };
  }

  it("returns null when every dimension is unknown", () => {
    const dims = [dim({ key: "spending", status: "unknown" }), dim({ key: "growth", status: "unknown" })];
    expect(worstKnownDimension(dims)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(worstKnownDimension([])).toBeNull();
  });

  it("picks the single known dimension when there's only one", () => {
    const only = dim({ key: "redundancy", score: 40, status: "attention" });
    expect(worstKnownDimension([only, dim({ key: "growth", status: "unknown" })])).toBe(only);
  });

  it("picks the lowest-scoring dimension among several known ones", () => {
    const worst = dim({ key: "redundancy", score: 24, status: "attention" });
    const dims = [dim({ key: "spending", score: 92, status: "watch" }), worst, dim({ key: "hygiene", score: 68, status: "watch" })];
    expect(worstKnownDimension(dims)).toBe(worst);
  });

  it("ignores unknown dimensions entirely when picking the worst", () => {
    const worst = dim({ key: "renewal", score: 68, status: "watch" });
    const dims = [dim({ key: "growth", status: "unknown" }), worst, dim({ key: "hygiene", status: "unknown" })];
    expect(worstKnownDimension(dims)).toBe(worst);
  });
});
