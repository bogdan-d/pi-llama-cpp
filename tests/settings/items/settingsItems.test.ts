import { describe, expect, it } from "vitest";
import { AutoloadOnMessageSettingsItem } from "../../../src/settings/items/autoloadOnMessage";
import { EnableSSESettingsItem } from "../../../src/settings/items/enableSse";
import { PollingIntervalSettingsItem } from "../../../src/settings/items/pollingInterval";
import { PollingTimeoutSettingsItem } from "../../../src/settings/items/pollingTimeout";
import { ReactToModelSelectSettingsItem } from "../../../src/settings/items/reactToModelSelect";
import { ServerTimeoutSettingsItem } from "../../../src/settings/items/serverTimeout";
import { ShowServerUrlsSettingsItem } from "../../../src/settings/items/showServerUrls";
import { SortBySettingsItem } from "../../../src/settings/items/sortBy";

// ─── EnableSSE ──────────────────────────────────────────────────────────────

describe("EnableSSESettingsItem", () => {
  const item = new EnableSSESettingsItem();

  it("formats true as 'on'", () => {
    expect(item.format({ enableSSE: true })).toBe("on");
  });

  it("formats false as 'off'", () => {
    expect(item.format({ enableSSE: false })).toBe("off");
  });

  it("formats missing value as default ('on')", () => {
    expect(item.format({})).toBe("on");
  });

  it("sets config to true when value is 'on'", () => {
    expect(item.setConfig({}, "on")).toEqual({
      valid: true,
      config: { enableSSE: true },
    });
  });

  it("sets config to false when value is 'off'", () => {
    expect(item.setConfig({}, "off")).toEqual({
      valid: true,
      config: { enableSSE: false },
    });
  });
});

// ─── AutoloadOnMessage ──────────────────────────────────────────────────────

describe("AutoloadOnMessageSettingsItem", () => {
  const item = new AutoloadOnMessageSettingsItem();

  it("formats true as 'on'", () => {
    expect(item.format({ autoloadOnMessage: true })).toBe("on");
  });

  it("formats false as 'off'", () => {
    expect(item.format({ autoloadOnMessage: false })).toBe("off");
  });

  it("formats missing value as default ('on')", () => {
    expect(item.format({})).toBe("on");
  });

  it("sets config to true when value is 'on'", () => {
    expect(item.setConfig({}, "on")).toEqual({
      valid: true,
      config: { autoloadOnMessage: true },
    });
  });

  it("sets config to false when value is 'off'", () => {
    expect(item.setConfig({}, "off")).toEqual({
      valid: true,
      config: { autoloadOnMessage: false },
    });
  });
});

// ─── ReactToModelSelect ─────────────────────────────────────────────────────

describe("ReactToModelSelectSettingsItem", () => {
  const item = new ReactToModelSelectSettingsItem();

  it("formats true as 'on'", () => {
    expect(item.format({ reactToModelSelect: true })).toBe("on");
  });

  it("formats false as 'off'", () => {
    expect(item.format({ reactToModelSelect: false })).toBe("off");
  });

  it("formats missing value as default ('on')", () => {
    expect(item.format({})).toBe("on");
  });

  it("sets config to true when value is 'on'", () => {
    expect(item.setConfig({}, "on")).toEqual({
      valid: true,
      config: { reactToModelSelect: true },
    });
  });

  it("sets config to false when value is 'off'", () => {
    expect(item.setConfig({}, "off")).toEqual({
      valid: true,
      config: { reactToModelSelect: false },
    });
  });
});

// ─── ShowServerUrls ─────────────────────────────────────────────────────────

describe("ShowServerUrlsSettingsItem", () => {
  const item = new ShowServerUrlsSettingsItem();

  it("formats true as 'on'", () => {
    expect(item.format({ showServerUrls: true })).toBe("on");
  });

  it("formats false as 'off'", () => {
    expect(item.format({ showServerUrls: false })).toBe("off");
  });

  it("formats missing value as default ('on')", () => {
    expect(item.format({})).toBe("on");
  });

  it("sets config to true when value is 'on'", () => {
    expect(item.setConfig({}, "on")).toEqual({
      valid: true,
      config: { showServerUrls: true },
    });
  });

  it("sets config to false when value is 'off'", () => {
    expect(item.setConfig({}, "off")).toEqual({
      valid: true,
      config: { showServerUrls: false },
    });
  });
});

// ─── PollingInterval ────────────────────────────────────────────────────────

describe("PollingIntervalSettingsItem", () => {
  const item = new PollingIntervalSettingsItem();

  it("formats 500ms as '500ms'", () => {
    expect(item.format({ pollingInterval: 500 })).toBe("500ms");
  });

  it("formats 1000ms as '1s'", () => {
    expect(item.format({ pollingInterval: 1000 })).toBe("1s");
  });

  it("formats missing value as default (500ms)", () => {
    expect(item.format({})).toBe("500ms");
  });

  it("sets config for a valid preset", () => {
    expect(item.setConfig({}, "500ms")).toEqual({
      valid: true,
      config: { pollingInterval: 500 },
    });
  });

  it("rejects an invalid value", () => {
    const result = item.setConfig({}, "999ms");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

// ─── PollingTimeout ─────────────────────────────────────────────────────────

describe("PollingTimeoutSettingsItem", () => {
  const item = new PollingTimeoutSettingsItem();

  it("formats 60000ms as '60s'", () => {
    expect(item.format({ pollingTimeout: 60000 })).toBe("60s");
  });

  it("formats 15000ms as '15s'", () => {
    expect(item.format({ pollingTimeout: 15000 })).toBe("15s");
  });

  it("formats missing value as default (60000ms)", () => {
    expect(item.format({})).toBe("60s");
  });

  it("sets config for a valid preset", () => {
    expect(item.setConfig({}, "60s")).toEqual({
      valid: true,
      config: { pollingTimeout: 60000 },
    });
  });

  it("rejects an invalid value", () => {
    const result = item.setConfig({}, "999ms");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

// ─── ServerTimeout ──────────────────────────────────────────────────────────

describe("ServerTimeoutSettingsItem", () => {
  const item = new ServerTimeoutSettingsItem();

  it("formats 1000ms as '1s'", () => {
    expect(item.format({ serverTimeout: 1000 })).toBe("1s");
  });

  it("formats 500ms as '500ms'", () => {
    expect(item.format({ serverTimeout: 500 })).toBe("500ms");
  });

  it("formats missing value as default (1000ms)", () => {
    expect(item.format({})).toBe("1s");
  });

  it("sets config for a valid preset", () => {
    expect(item.setConfig({}, "1s")).toEqual({
      valid: true,
      config: { serverTimeout: 1000 },
    });
  });

  it("rejects an invalid value", () => {
    const result = item.setConfig({}, "999ms");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

// ─── SortBy ─────────────────────────────────────────────────────────────────

describe("SortBySettingsItem", () => {
  const item = new SortBySettingsItem();

  it("formats 'asc' as 'Ascending'", () => {
    expect(item.format({ sortBy: "asc" })).toBe("Ascending");
  });

  it("formats 'desc' as 'Descending'", () => {
    expect(item.format({ sortBy: "desc" })).toBe("Descending");
  });

  it("formats missing value as default ('asc' → 'Ascending')", () => {
    expect(item.format({})).toBe("Ascending");
  });

  it("sets config for a valid label", () => {
    expect(item.setConfig({}, "Ascending")).toEqual({
      valid: true,
      config: { sortBy: "asc" },
    });
  });

  it("rejects an invalid label", () => {
    const result = item.setConfig({}, "Random");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
