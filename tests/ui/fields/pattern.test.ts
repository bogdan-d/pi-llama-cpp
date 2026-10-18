import { describe, expect, it } from "vitest";
import { PatternField } from "../../../src/ui/editors/override/fields/pattern";
import { OverrideEntry } from "../../../src/ui/editors/override/entry";

describe("PatternField", () => {
  const field = new PatternField();

  it("has the correct id and type", () => {
    expect(field.id).toBe("pattern");
    expect(field.type).toBe("input");
  });

  it("returns the entry's pattern as display value", () => {
    const entry = new OverrideEntry("gpt-*", {});
    expect(field.displayValue(entry)).toBe("gpt-*");
  });

  it("accepts non-empty trimmed values", () => {
    expect(field.validate("abc")).toBe("abc");
    expect(field.validate("  test  ")).toBe("test");
    expect(field.validate("a")).toBe("a");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(field.validate("")).toBeNull();
    expect(field.validate("   ")).toBeNull();
  });
});
