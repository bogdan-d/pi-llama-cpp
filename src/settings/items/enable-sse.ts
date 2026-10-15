import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export class EnableSSESettingsItem extends SettingsItem<boolean> {
  readonly id = "enableSSE";
  readonly label = "Enable SSE";
  readonly description = "Use SSE to track model loading progress (next open)";
  readonly values = ["on", "off"];

  static get defaultValue(): boolean {
    return true;
  }

  format(config: LlamaSettings): string {
    return (config[this.id] ?? EnableSSESettingsItem.defaultValue)
      ? "on"
      : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { enableSSE: value === "on" },
    };
  }
}
