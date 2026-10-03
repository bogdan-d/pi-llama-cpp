import type { LlamaSettings } from "../../interfaces/settings";
import type { SortBy } from "../../interfaces/sortBy";
import { SettingsItem, type ValidationResult } from "../base";
import { invertLabels, SORT_BY_LABELS } from "../options";

export const SORT_BY_DEFAULT: SortBy = "asc";

export class SortBySettingsItem extends SettingsItem<SortBy> {
  readonly id = "sortBy";
  readonly label = "Sort models by";
  readonly description = "Order of models in /models (next open)";
  readonly values = Object.values(SORT_BY_LABELS);

  format(config: LlamaSettings): string {
    const value = config[this.id];
    return value ? SORT_BY_LABELS[value] : SORT_BY_LABELS[SORT_BY_DEFAULT];
  }

  setConfig(_config: LlamaSettings, value: string): ValidationResult {
    const inverted = invertLabels(SORT_BY_LABELS);
    const parsed = inverted[value];
    if (!parsed) {
      return { valid: false, errors: [`Invalid sort order: "${value}"`] };
    }
    return {
      valid: true,
      config: { sortBy: parsed },
    };
  }

  getDefault(): SortBy {
    return SORT_BY_DEFAULT;
  }
}
