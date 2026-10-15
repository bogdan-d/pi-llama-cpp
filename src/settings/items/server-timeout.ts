import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";
import { formatMs, parseMs, SERVER_PRESETS } from "../options";

export class ServerTimeoutSettingsItem extends SettingsItem<number> {
  readonly id = "serverTimeout";
  readonly label = "Server timeout";
  readonly description = "Health check / SSE probe timeout (next model load)";
  readonly values = SERVER_PRESETS.map(formatMs);

  static get defaultValue(): number {
    return 1000;
  }

  format(config: LlamaSettings): string {
    const value = config[this.id] ?? ServerTimeoutSettingsItem.defaultValue;
    return formatMs(value);
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    const parsed = parseMs(value);
    if (!SERVER_PRESETS.includes(parsed)) {
      return { valid: false, errors: [`Invalid server timeout: "${value}"`] };
    }
    return {
      valid: true,
      config: { serverTimeout: parsed },
    };
  }
}
