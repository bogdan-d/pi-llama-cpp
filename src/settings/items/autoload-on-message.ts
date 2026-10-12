import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export class AutoloadOnMessageSettingsItem extends SettingsItem<boolean> {
  readonly id = "autoloadOnMessage";
  readonly label = "Autoload on message";
  readonly description =
    "Auto-load the selected model when you send a message (immediate)";
  readonly values = ["on", "off"];

  static get defaultValue(): boolean {
    return false;
  }

  format(config: LlamaSettings): string {
    return (config[this.id] ?? AutoloadOnMessageSettingsItem.defaultValue)
      ? "on"
      : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { autoloadOnMessage: value === "on" },
    };
  }
}
