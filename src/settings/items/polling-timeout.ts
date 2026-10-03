import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";
import { formatMs, parseMs, POLLING_PRESETS } from "../options";

export const POLLING_TIMEOUT_DEFAULT = 60000;

export class PollingTimeoutSettingsItem extends SettingsItem<number> {
  readonly id = "pollingTimeout";
  readonly label = "Polling timeout";
  readonly description = "Max model-load wait (next model load)";
  readonly values = POLLING_PRESETS.map(formatMs);

  format(config: LlamaSettings): string {
    const value = config[this.id] ?? POLLING_TIMEOUT_DEFAULT;
    return formatMs(value);
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    const parsed = parseMs(value);
    if (!POLLING_PRESETS.includes(parsed)) {
      return { valid: false, errors: [`Invalid polling timeout: "${value}"`] };
    }
    return {
      valid: true,
      config: { pollingTimeout: parsed },
    };
  }

  getDefault(): number {
    return POLLING_TIMEOUT_DEFAULT;
  }
}
