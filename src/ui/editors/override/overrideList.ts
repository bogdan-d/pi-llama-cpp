import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  Component,
  Focusable,
  SettingsList,
  type SettingItem,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../interfaces/settings";
import type { SettingsService } from "../../../settings/settings";
import { HINTS } from "../../strings";
import type { OverrideSettingsListOptions } from "../editorOptions";
import { OverrideEntryListEditor } from "./entryEditor";

/**
 * Top-level overrides editor: one row per server, Enter drills into
 * override entries.
 *
 * Unlike `ServerSettingsList`, this has no add/delete — just drill-down.
 * There is deliberately no `r` reset here either: reset lives inside an
 * entry's field submenu (`OverrideEntryListEditor`).
 *
 * Within a server's entry list: Enter drills into the field-edit submenu;
 * a adds, d deletes (after confirmation). Fields use a mix of finite
 * (Enter to cycle) and infinite (Enter to type) editing:
 *
 * - Pattern / costs (input, output, cacheRead, cacheWrite): infinite —
 *   Enter opens an Input for typing.
 * - Capabilities: finite — Enter cycles between `text` and `text | image`.
 * - Reasoning: finite — Enter cycles between `true` and `false`.
 *
 * Servers themselves are not managed here — use `/models servers`.
 */
export class OverrideSettingsList implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private isFocused = false;

  constructor(private readonly options: OverrideSettingsListOptions) {
    this.settingsList = this.buildSettingsList();
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog seeded with the
   * current `llamaSettings.servers` and resolves when the user closes
   * it (Esc). Writes go through `settings.setLlamaSettings()`; write
   * errors are notified via `ui` and the editor stays open with the
   * pre-mutation list.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: SettingsService,
  ): Promise<void> {
    const servers = await settings.getLlamaServers();

    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new OverrideSettingsList({
          tui,
          theme,
          keybindings,
          servers,
          persist: (next) => settings.setLlamaSettings({ servers: next }),
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
          onChanged: () => {}, // no per-change notification needed
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
    // `SettingsList` has no `focused` flag — the flag is ours alone
    this.isFocused = value;
  }

  // -- internal --------------------------------------------------------------

  private buildSettingsList(): SettingsList {
    const serverItems: SettingItem[] = this.options.servers.map(
      (server, i) => ({
        id: `server-${i}`,
        label: server.url,
        description: HINTS.overrideServerRow,
        currentValue: OverrideSettingsList.entriesLabel(server),
        submenu: (_cv, done) =>
          new OverrideEntryListEditor(this.options, i, () => {
            // Entry count may have changed (add/delete/pattern rename)
            const current = this.options.servers[i];
            this.settingsList?.updateValue(
              `server-${i}`,
              OverrideSettingsList.entriesLabel(current),
            );
            done();
          }),
      }),
    );

    return new SettingsList(
      serverItems,
      Math.min(serverItems.length + 2, 15),
      getSettingsListTheme(),
      () => {}, // no per-item change handler
      () => this.options.done(),
    );
  }

  /** Row summary for a server in the list: its override entry count. */
  private static entriesLabel(server: LlamaServer | undefined): string {
    return `${Object.keys(server?.overrides ?? {}).length} entries`;
  }
}
