import { describe, it, expect } from "vitest";
import { summarizeImport, summarizeImports } from "./history";
import type { Import } from "@/lib/db/schema";

let nextId = 1;
function importRecord(overrides: Partial<Import>): Import {
  return {
    id: `import-${nextId++}`,
    userId: "user-1",
    source: "csv_import",
    status: "completed",
    detectedCount: 3,
    importedCount: 2,
    ignoredCount: 1,
    errors: [],
    createdAt: new Date("2026-01-15T10:30:00.000Z"),
    ...overrides,
  };
}

describe("summarizeImport", () => {
  it("maps each source enum value to its display label", () => {
    expect(summarizeImport(importRecord({ source: "csv_import" })).sourceLabel).toBe("Bank CSV");
    expect(summarizeImport(importRecord({ source: "apple_import" })).sourceLabel).toBe("Apple Subscriptions");
    expect(summarizeImport(importRecord({ source: "google_play_import" })).sourceLabel).toBe("Google Play");
  });

  it("maps each status enum value to a label and badge variant", () => {
    const completed = summarizeImport(importRecord({ status: "completed" }));
    expect(completed.statusLabel).toBe("Completed");
    expect(completed.statusVariant).toBe("default");

    const failed = summarizeImport(importRecord({ status: "failed" }));
    expect(failed.statusLabel).toBe("Failed");
    expect(failed.statusVariant).toBe("destructive");

    const reviewed = summarizeImport(importRecord({ status: "reviewed" }));
    expect(reviewed.statusLabel).toBe("In review");
    expect(reviewed.statusVariant).toBe("secondary");
  });

  it("passes through the detected/imported/ignored counts unchanged", () => {
    const summary = summarizeImport(importRecord({ detectedCount: 8, importedCount: 5, ignoredCount: 3 }));
    expect(summary.detectedCount).toBe(8);
    expect(summary.importedCount).toBe(5);
    expect(summary.ignoredCount).toBe(3);
  });

  it("flags hasErrors true only when the errors array is non-empty", () => {
    expect(summarizeImport(importRecord({ errors: [] })).hasErrors).toBe(false);
    expect(summarizeImport(importRecord({ errors: [{ message: "boom" }] })).hasErrors).toBe(true);
  });

  it("formats the timestamp as a readable date/time label", () => {
    const summary = summarizeImport(importRecord({ createdAt: new Date("2026-01-15T10:30:00.000Z") }));
    expect(summary.createdAtLabel).toContain("2026");
    expect(summary.createdAtIso).toBe("2026-01-15T10:30:00.000Z");
  });
});

describe("summarizeImports", () => {
  it("maps an empty list to an empty list", () => {
    expect(summarizeImports([])).toEqual([]);
  });

  it("preserves order and maps every record", () => {
    const records = [importRecord({ source: "csv_import" }), importRecord({ source: "apple_import" })];
    const summaries = summarizeImports(records);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].sourceLabel).toBe("Bank CSV");
    expect(summaries[1].sourceLabel).toBe("Apple Subscriptions");
  });
});
