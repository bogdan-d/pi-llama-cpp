import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import type { LlamaSettings } from "../../interfaces/settings";
import type { LlamaSettingsManager } from "../../managers/settings";
import { ResettableSettingsList } from "../../ui/resettable-settings-list";
import { SETTINGS_ITEMS } from "../defaults";

/** Options passed to the settings editor. */
export interface SettingsEditorOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  settings: LlamaSettingsManager;
  /** Called when Esc closes the editor. */
  done: () => void;
  /** Called on persistence errors. */
  onError: (message: string) => void;
}

/**
 * Interactive settings menu for the scalar `llamaSettings` fields.
 * Enter/Space cycles the value under the cursor; Esc closes.
 *
 * Reads from `LlamaSettingsManager` for the current config and writes
 * via `setLlamaSetting()`; write errors are notified and leave the
 * dialog open with values unchanged.
 */
export class SettingsEditor implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private isFocused = false;
  private currentConfig: LlamaSettings | null = null;

  constructor(private readonly options: SettingsEditorOptions) {
    void this.buildList();
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog and resolves when the
   * user closes it (Esc). Write errors are notified via `ui` and leave
   * the dialog open with values unchanged.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: LlamaSettingsManager,
  ): Promise<void> {
    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new SettingsEditor({
          tui,
          theme,
          keybindings,
          settings,
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
        }),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.settingsList?.invalidate();
  }

  handleInput(data: string): void {
    this.settingsList?.handleInput(data);
  }

  render(width: number): string[] {
    if (!this.settingsList) return ["Loading..."];
    return this.settingsList.render(width);
  }

  // -- Focusable -------------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }

  // -- internal --------------------------------------------------------------

  private async buildList(): Promise<void> {
    this.currentConfig = await this.options.settings.getLlamaSettings();
    if (!this.currentConfig) return;

    const items = Object.values(SETTINGS_ITEMS).map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      currentValue: item.format(this.currentConfig!),
      ...(item.values ? { values: item.values } : {}),
    }));

    const onChangeFn = async (id: string, newValue: string): Promise<void> => {
      if (!this.currentConfig) return;
      const item = SETTINGS_ITEMS[id];
      if (!item) return;
      const result = item.setConfig(this.currentConfig, newValue);
      if (!result.valid) {
        this.options.onError(result.errors?.join("\n") ?? "Invalid value.");
        return;
      }
      await this.options.settings.setLlamaSettings(result.config!);
      this.currentConfig = await this.options.settings.getLlamaSettings();
      this.settingsList?.updateValue(id, item.format(this.currentConfig));
      this.options.tui.requestRender();
    };

    const onResetFn = async (id: string): Promise<void> => {
      const item = SETTINGS_ITEMS[id];
      if (!item) return;
      await this.options.settings.deleteLlamaSetting(item.id);
      this.currentConfig = await this.options.settings.getLlamaSettings();
      this.settingsList?.updateValue(id, item.format(this.currentConfig));
      this.options.tui.requestRender();
    };

    this.settingsList = new ResettableSettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      onChangeFn,
      () => this.options.done(),
      onResetFn,
      this.options.tui,
    );
  }
}
