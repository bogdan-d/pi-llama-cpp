import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export const AUTOLOAD_ON_MESSAGE_DEFAULT = false;

export class AutoloadOnMessageSettingsItem extends SettingsItem<boolean> {
  readonly id = "autoloadOnMessage";
  readonly label = "Autoload on message";
  readonly description =
    "Auto-load the selected model when you send a message (immediate)";
  readonly values = ["on", "off"];

  format(config: LlamaSettings): string {
    return (config[this.id] ?? AUTOLOAD_ON_MESSAGE_DEFAULT) ? "on" : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { autoloadOnMessage: value === "on" },
    };
  }

  getDefault(): boolean {
    return AUTOLOAD_ON_MESSAGE_DEFAULT;
  }
}
