import type { LlamaSettings } from "../../interfaces/settings";
import { SettingsItem, type ValidationResult } from "../base";

export const REACT_TO_MODEL_SELECT_DEFAULT = true;

export class ReactToModelSelectSettingsItem extends SettingsItem<boolean> {
  readonly id = "reactToModelSelect";
  readonly label = "React to model selection";
  readonly description = "Load the model when you pick it in Pi (immediate)";
  readonly values = ["on", "off"];

  format(config: LlamaSettings): string {
    return (config[this.id] ?? REACT_TO_MODEL_SELECT_DEFAULT) ? "on" : "off";
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    return {
      valid: true,
      config: { reactToModelSelect: value === "on" },
    };
  }

  getDefault(): boolean {
    return REACT_TO_MODEL_SELECT_DEFAULT;
  }
}
