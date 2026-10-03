import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export const SHOW_SERVER_URLS_DEFAULT = true;

export class ShowServerUrlsSettingsItem extends SettingsItem<boolean> {
  readonly id = "showServerUrls";
  readonly label = "Show server URLs";
  readonly description = "Show [Server: <url>] in /models (next open)";
  readonly values = ["on", "off"];

  format(config: LlamaSettings): string {
    return (config[this.id] ?? SHOW_SERVER_URLS_DEFAULT) ? "on" : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { showServerUrls: value === "on" },
    };
  }

  getDefault(): boolean {
    return SHOW_SERVER_URLS_DEFAULT;
  }
}
