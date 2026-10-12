import type { LlamaSettings } from "../interfaces/settings";

/**
 * Validation result returned by `setConfig`.
 */
export interface ValidationResult {
  valid: boolean;
  config?: Partial<LlamaSettings>;
  errors?: string[];
}

/**
 * Abstract base for all settings items.
 *
 * Each concrete subclass owns its own:
 * - `id` — unique setting identifier
 * - `label` — display name
 * - `description` — help text
 * - `values` — possible values (for dropdowns)
 * - `format(config)` — reads current value → string
 * - `setConfig(config, value)` — validates and returns partial config
 * - `defaultValue` — static getter returning the default value (defined in each subclass)
 */
export abstract class SettingsItem<T = unknown> {
  /** @internal */ protected _type!: T;
  abstract readonly id: keyof LlamaSettings & string;
  abstract readonly label: string;
  abstract readonly description: string;
  readonly values?: string[];

  /**
   * Formats the current value from config into a display string.
   * Always returns a string (falls back to default when config value is absent).
   */
  abstract format(config: LlamaSettings): string;

  /**
   * Validates and writes a new value. Returns a partial config to persist.
   */
  abstract setConfig(config: LlamaSettings, value: string): ValidationResult;

  /**
   * Returns the default value for this setting.
   * Each subclass defines its own `static get defaultValue()`.
   */
}
