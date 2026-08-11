import { describe, it, expect } from "vitest";
import { parseSubscriptionSystemPrompt, narrateInsightsSystemPrompt } from "./anthropic-provider";

// Regression coverage for the indirect-prompt-injection hardening: both
// prompts must keep telling the model to treat the content they're handed
// (user-typed text; insight titles/descriptions built from user-entered or
// imported subscription/merchant names) as data, never as instructions —
// without needing to mock the Anthropic SDK client just to inspect the
// string sent as `system`.
describe("parseSubscriptionSystemPrompt", () => {
  it("instructs the model to treat the input as data, not instructions", () => {
    const prompt = parseSubscriptionSystemPrompt("2026-01-01");
    expect(prompt).toMatch(/data.*never.*instructions|treat.*strictly as data/i);
    expect(prompt).toContain("2026-01-01");
  });
});

describe("narrateInsightsSystemPrompt", () => {
  it("instructs the model to treat insight titles/descriptions as data, not instructions", () => {
    const prompt = narrateInsightsSystemPrompt();
    expect(prompt).toMatch(/treat every title and description.*data to rephrase.*never as instructions/i);
  });

  it("still constrains numeric fidelity and output shape", () => {
    const prompt = narrateInsightsSystemPrompt();
    expect(prompt).toMatch(/never invent or recompute figures/i);
    expect(prompt).toMatch(/one sentence per input/i);
  });
});
