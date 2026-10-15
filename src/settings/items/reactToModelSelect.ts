import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export class ReactToModelSelectSettingsItem extends SettingsItem<boolean> {
  readonly id = "reactToModelSelect";
  readonly label = "React to model selection";
  readonly description = "Load the model when you pick it in Pi (immediate)";
  readonly values = ["on", "off"];

  static get defaultValue(): boolean {
    return true;
  }

  format(config: LlamaSettings): string {
    return (config[this.id] ?? ReactToModelSelectSettingsItem.defaultValue)
      ? "on"
      : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { reactToModelSelect: value === "on" },
    };
  }
}
