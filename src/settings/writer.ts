import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import { SETTINGS_KEY } from "../constants";
import { LlamaSettings } from "../interfaces/settings";
import { SettingsStore } from "./store";

/**
 * Settings persistence layer.
 *
 * Owns write operations: merging partial updates into the settings file
 * and reloading Pi's in-memory settings so resolvers see changes immediately.
 */
export class SettingsWriter {
  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly globalStore: SettingsStore,
    private readonly projectStore: SettingsStore,
  ) {}

  /**
   * Persists multiple llamaSettings fields to settings and reloads the
   * in-memory settings so resolvers see the change immediately.
   * Writes to project `.pi/settings.json` if it exists, otherwise global.
   *
   * Rejects if the file can't be read (e.g. invalid JSON) or written —
   * in-memory state stays consistent (reload only on success).
   */
  async setLlamaSettings(partial: Partial<LlamaSettings>): Promise<void> {
    const store = await this.resolveStore();
    await store.updateKey(SETTINGS_KEY, (current) => {
      const merged =
        typeof current === "object" && current !== null
          ? { ...(current as Record<string, unknown>) }
          : {};
      return { ...merged, ...partial };
    });
    await this.settingsManager.reload();
  }

  /**
   * Deletes one llamaSettings field from settings and reloads the in-memory
   * settings so resolvers fall back to the built-in default.
   *
   * Rejects if the file can't be read or written.
   */
  async deleteLlamaSetting<K extends keyof LlamaSettings>(
    key: K,
  ): Promise<void> {
    const store = await this.resolveStore();
    await store.updateKey(SETTINGS_KEY, (current) => {
      const merged =
        typeof current === "object" && current !== null
          ? { ...(current as Record<string, unknown>) }
          : {};
      delete merged[key as string];
      return merged;
    });
    await this.settingsManager.reload();
  }

  private async resolveStore(): Promise<SettingsStore> {
    return (await this.hasProjectSettings())
      ? this.projectStore
      : this.globalStore;
  }

  private async hasProjectSettings(): Promise<boolean> {
    try {
      await access(this.projectStore.projectPath);
      return true;
    } catch {
      return false;
    }
  }
}
