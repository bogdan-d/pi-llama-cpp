import { describe, expect, it } from "vitest";
import type { ModelOverride } from "../../../src/interfaces/settings";
import { CapabilitiesField } from "../../../src/ui/editors/override/fields/capabilities";
import { OverrideEntry } from "../../../src/ui/editors/override/entry";

describe("CapabilitiesField", () => {
  const field = new CapabilitiesField();

  it("has the correct id and type", () => {
    expect(field.id).toBe("capabilities");
    expect(field.type).toBe("finite");
  });

  it("defaults to 'text' when capabilities is undefined", () => {
    const entry = new OverrideEntry("gpt-*", {});
    expect(field.displayValue(entry)).toBe("text");
  });

  it("shows 'text | image' when both capabilities are set", () => {
    const entry = new OverrideEntry("gpt-*", {
      capabilities: ["text", "image"],
    });
    expect(field.displayValue(entry)).toBe("text | image");
  });

  it("shows 'text' when only text is set", () => {
    const entry = new OverrideEntry("gpt-*", { capabilities: ["text"] });
    expect(field.displayValue(entry)).toBe("text");
  });

  it("accepts only valid options", () => {
    expect(field.validate("text")).toBe("text");
    expect(field.validate("text | image")).toBe("text | image");
    expect(field.validate("image")).toBeNull();
    expect(field.validate("")).toBeNull();
  });

  it("sets capabilities from 'text | image'", () => {
    const override: ModelOverride = {};
    field.apply(override, "text | image");
    expect(override.capabilities).toEqual(["text", "image"]);
  });

  it("sets capabilities from 'text'", () => {
    const override: ModelOverride = {};
    field.apply(override, "text");
    expect(override.capabilities).toEqual(["text"]);
  });

  it("removes capabilities on invalid value", () => {
    const override: ModelOverride = { capabilities: ["text"] };
    field.apply(override, "invalid");
    expect(override.capabilities).toBeUndefined();
  });

  it("removes the capabilities key and returns true when present", () => {
    const override: ModelOverride = { capabilities: ["text", "image"] };
    const removed = field.remove(override);
    expect(removed).toBe(true);
    expect(override.capabilities).toBeUndefined();
  });

  it("returns false when capabilities is already absent", () => {
    const override: ModelOverride = {};
    const removed = field.remove(override);
    expect(removed).toBe(false);
  });

  it("includes capabilities in summary when non-empty", () => {
    expect(field.summaryPart({ capabilities: ["text"] })).toBe(
      "capabilities: text",
    );
    expect(field.summaryPart({ capabilities: ["text", "image"] })).toBe(
      "capabilities: text,image",
    );
  });

  it("returns null when capabilities is not set", () => {
    expect(field.summaryPart({})).toBeNull();
  });
});
