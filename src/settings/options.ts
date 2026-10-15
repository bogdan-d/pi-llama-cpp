import type { SortBy } from "../interfaces/sortBy";

// ─── Sort labels ────────────────────────────────────────────────────────────

/** Label map for `sortBy` setting: config value → display label */
export const SORT_BY_LABELS: Record<SortBy, string> = {
  asc: "Ascending",
  desc: "Descending",
  "asc-name": "Ascending (name)",
  "desc-name": "Descending (name)",
  api: "API order",
};

/** Inverts a label map, swapping keys and values. */
export const invertLabels = <K extends string>(
  obj: Record<K, string>,
): Record<string, K> => {
  const result = {} as Record<string, K>;
  for (const key in obj) {
    result[obj[key]] = key;
  }
  return result;
};

// ─── Presets ────────────────────────────────────────────────────────────────

/** Presets (ms) for `pollingTimeout` */
export const POLLING_PRESETS = [15000, 30000, 60000, 120000, 300000];

/** Presets (ms) for `serverTimeout` */
export const SERVER_PRESETS = [500, 1000, 2000, 5000, 10000];

/** Presets (ms) for `pollingInterval` */
export const POLLING_INTERVAL_PRESETS = [250, 500, 1000, 2000];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats milliseconds compactly for display (e.g. `500 -> "500ms"`,
 * `60000 -> "60s"`).
 */
export const formatMs = (ms: number): string =>
  ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;

/**
 * Parses a value produced by `formatMs()` back to milliseconds.
 * Only ever called with values from the preset lists.
 */
export const parseMs = (value: string): number =>
  value.endsWith("ms")
    ? Number(value.slice(0, -2))
    : Number(value.slice(0, -1)) * 1000;
