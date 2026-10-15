import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export class ShowServerUrlsSettingsItem extends SettingsItem<boolean> {
  readonly id = "showServerUrls";
  readonly label = "Show server URLs";
  readonly description = "Show [Server: <url>] in /models (next open)";
  readonly values = ["on", "off"];

  static get defaultValue(): boolean {
    return true;
  }

  format(config: LlamaSettings): string {
    return (config[this.id] ?? ShowServerUrlsSettingsItem.defaultValue)
      ? "on"
      : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { showServerUrls: value === "on" },
    };
  }
}
