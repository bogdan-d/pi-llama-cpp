import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export const ENABLE_SSE_DEFAULT = true;

export class EnableSSESettingsItem extends SettingsItem<boolean> {
  readonly id = "enableSSE";
  readonly label = "Enable SSE";
  readonly description = "Use SSE to track model loading progress (next open)";
  readonly values = ["on", "off"];

  format(config: LlamaSettings): string {
    return (config[this.id] ?? ENABLE_SSE_DEFAULT) ? "on" : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { enableSSE: value === "on" },
    };
  }

  getDefault(): boolean {
    return ENABLE_SSE_DEFAULT;
  }
}
