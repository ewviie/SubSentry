import { describe, it, expect } from "vitest";
import { neutralizeFormulaInjection } from "./sanitize";

describe("neutralizeFormulaInjection", () => {
  it.each(["=", "+", "-", "@"])("prefixes a value starting with %s with a leading apostrophe", (char) => {
    const value = `${char}cmd|'/c calc'!A1`;
    expect(neutralizeFormulaInjection(value)).toBe(`'${value}`);
  });

  it("leaves a value starting with a safe character untouched", () => {
    expect(neutralizeFormulaInjection("Netflix")).toBe("Netflix");
    expect(neutralizeFormulaInjection("3-2-1 Storage")).toBe("3-2-1 Storage");
  });

  it("leaves an injection-prefix character untouched when it's not in the leading position", () => {
    // Guards against over-aggressive sanitization mangling legitimate
    // strings that merely contain one of these characters mid-string.
    expect(neutralizeFormulaInjection("AT&T =Mobile")).toBe("AT&T =Mobile");
    expect(neutralizeFormulaInjection("Buy One Get 1+1")).toBe("Buy One Get 1+1");
  });

  it("ignores leading whitespace when checking the first character", () => {
    expect(neutralizeFormulaInjection("  =SUM(A1:A9)")).toBe("'  =SUM(A1:A9)");
  });

  it("leaves an empty string untouched", () => {
    expect(neutralizeFormulaInjection("")).toBe("");
  });
});
