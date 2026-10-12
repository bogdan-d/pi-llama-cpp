import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";
import { formatMs, parseMs, POLLING_INTERVAL_PRESETS } from "../options";

export class PollingIntervalSettingsItem extends SettingsItem<number> {
  readonly id = "pollingInterval";
  readonly label = "Polling interval";
  readonly description = "Time between status checks during load/unload";
  readonly values = POLLING_INTERVAL_PRESETS.map(formatMs);

  static get defaultValue(): number {
    return 500;
  }

  format(config: LlamaSettings): string {
    const value = config[this.id] ?? PollingIntervalSettingsItem.defaultValue;
    return formatMs(value);
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    const parsed = parseMs(value);
    if (!POLLING_INTERVAL_PRESETS.includes(parsed)) {
      return { valid: false, errors: [`Invalid polling interval: "${value}"`] };
    }
    return {
      valid: true,
      config: { pollingInterval: parsed },
    };
  }
}
