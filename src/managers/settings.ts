import { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { LLAMA_SERVER_URL, SETTINGS_KEY, THINKING_BUDGETS } from "../constants";
import { PollingIntervalSettingsItem } from "../settings/items/polling-interval";
import { AutoloadOnMessageSettingsItem } from "../settings/items/autoload-on-message";
import { PollingTimeoutSettingsItem } from "../settings/items/polling-timeout";
import { ReactToModelSelectSettingsItem } from "../settings/items/react-to-model-select";
import { ServerTimeoutSettingsItem } from "../settings/items/server-timeout";
import { ShowServerUrlsSettingsItem } from "../settings/items/show-server-urls";
import { SortBySettingsItem } from "../settings/items/sort-by";
import {
  LlamaServer,
  LlamaSettings,
  ModelOverride,
} from "../interfaces/settings";
import type {
  ServerOptions,
  ServerSettingsResolver,
} from "../interfaces/server";
import type { SortBy } from "../interfaces/sortBy";
import { CredentialResolver } from "../utils/credentialResolver";
import { ServerUrl } from "../utils/urls";
import { SettingsStore } from "../utils/settingsStore";

export class LlamaSettingsManager implements ServerSettingsResolver {
  /**
   * Creates a new LlamaSettingsManager.
   *
   * @param settingsManager - Pi SDK settings manager (in-memory merged view)
   * @param globalStore - Store for the global `settings.json` file.
   * @param projectStore - Store for the project `.pi/settings.json` file.
   * @param credentialResolver - Resolves API keys from credential values.
   */
  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly globalStore: SettingsStore = new SettingsStore(
      join(getAgentDir(), "settings.json"),
    ),
    private readonly projectStore: SettingsStore = new SettingsStore(
      join(process.cwd(), ".pi", "settings.json"),
    ),
    private readonly credentialResolver: CredentialResolver = new CredentialResolver(),
  ) {}

  /**
   * Check if project settings file exists in the current working directory.
   */
  private async hasProjectSettings(): Promise<boolean> {
    try {
      await access(join(process.cwd(), ".pi", "settings.json"));
      return true;
    } catch {
      return false;
    }
  }

  /** Warnings collected during URL resolution (dropped invalid entries). */
  private warnings: string[] = [];

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;
    return warnings;
  }

  /**
   * Reloads settings from disk and returns merged project/global settings.
   * Project settings override global settings.
   */
  private async getMergedSettings(): Promise<Record<string, any>> {
    await this.settingsManager.reload();
    return {
      ...this.settingsManager.getGlobalSettings(),
      ...this.settingsManager.getProjectSettings(),
    } as Record<string, any>;
  }

  /**
   * Convenience method for the `llamaSettings` key.
   * Reloads settings from disk before reading.
   */
  async getLlamaSettings(): Promise<LlamaSettings> {
    return (await this.getMergedSettings())[SETTINGS_KEY] ?? {};
  }

  /**
   * Convenience method for the merged `servers` list (project overrides
   * global, per-key merge). Reloads settings from disk before reading.
   */
  async getLlamaServers(): Promise<LlamaServer[]> {
    return (await this.getLlamaSettings()).servers ?? [];
  }

  /**
   * Resolves the server URLs to use in the following order:
   *
   * - `LLAMA_SERVER_URL` env variable
   * - `llamaSettings.servers[].url` (current — project, then global)
   * - `llamaServerUrl` key (legacy — project, then global)
   * - Default URL
   *
   * @returns The list of URLs to use
   */
  async resolveUrls(): Promise<string[]> {
    let response = this.resolveEnvUrls();
    if (response.length > 0) return response;

    response = await this.resolveServerUrls();
    if (response.length > 0) return response;

    response = await this.resolveLegacyUrls();
    if (response.length > 0) return response;

    return [LLAMA_SERVER_URL];
  }

  private resolveEnvUrls(): string[] {
    const raw = process.env.LLAMA_SERVER_URL;
    if (!raw) return [];
    return this.parseUrls(raw);
  }

  private async resolveServerUrls(): Promise<string[]> {
    const { servers = [] } = await this.getLlamaSettings();
    return servers.map((s) => this.parseUrls(s.url)).flat();
  }

  private async resolveLegacyUrls(): Promise<string[]> {
    const { llamaServerUrl = null } = await this.getMergedSettings();
    if (!llamaServerUrl) return [];
    return this.parseUrls(llamaServerUrl);
  }

  /**
   * Parses a raw URL string into an array of cleaned URLs.
   * Splits on semicolons, trims whitespace, filters empty strings, strips
   * trailing slashes, and drops entries without an http(s) scheme —
   * collecting a warning for each dropped entry.
   *
   * @param raw - The raw URL string (possibly semicolon-separated)
   * @returns A sanitized array of URLs
   */
  private parseUrls(raw: string): string[] {
    return raw
      .split(";")
      .map(ServerUrl.normalize)
      .filter((u) => {
        if (u.length === 0) return false;
        if (!ServerUrl.isValid(u)) {
          this.warnings.push(
            `Ignoring invalid server URL '${u}' (needs http(s)://)`,
          );
          return false;
        }
        return true;
      });
  }

  /**
   * Resolves the override map for a given server URL.
   *
   * Reads the `overrides` field from the matching server config and returns
   * a map of model ID → override. Returns an empty object when the server
   * has no `overrides` defined.
   *
   * @param serverUrl - The URL of the server to resolve overrides for
   * @returns A map of model ID to override configuration (partial fields,
   *          fallbacks applied at consumption time)
   */
  async resolveServerOverrides(
    serverUrl: string,
  ): Promise<Record<string, ModelOverride>> {
    const serverConfig = (await this.getLlamaSettings()).servers?.find(
      (s: { url: string }) => s.url === serverUrl,
    );
    return serverConfig?.overrides ?? {};
  }

  /**
   * Resolves the raw server configurations that this extension will use.
   * Uses `resolveUrls()` as the source of truth for URLs (env > settings >
   * legacy > default), then applies `id`/`name`/`overrides` from
   * `llamaSettings.servers` when available.
   * Reloads settings from disk before reading.
   *
   * @returns A list of ServerOptions for building `Server` instances
   */
  async resolveServerConfigs(): Promise<ServerOptions[]> {
    const urls = await this.resolveUrls();
    const serverConfigs = (await this.getLlamaSettings()).servers ?? [];

    const configs: ServerOptions[] = [];
    for (const url of urls) {
      const config = serverConfigs.find((s) => s.url === url);
      const overrides = await this.resolveServerOverrides(url);
      configs.push({
        baseUrl: url,
        customId: config?.id,
        customName: config?.name,
        overrides,
      });
    }
    return configs;
  }

  /**
   * Resolves API key for the provider ID using Pi's stored credentials.
   * Delegates to the injected credential resolver, which owns the
   * credential-store lookup and key format handling.
   *
   * @param providerId The provider ID
   * @returns The API key to use for the provider
   */
  resolveApiKey(providerId: string): string {
    return this.credentialResolver.resolveForProvider(providerId);
  }

  /**
   * Resolves the current thinking level from Pi.
   *
   * @returns The thinking level
   */
  resolveThinkingLevel(): ModelThinkingLevel | undefined {
    return this.settingsManager.getDefaultThinkingLevel();
  }

  /**
   * Resolves the effective thinking budgets from settings.
   *
   * @returns An object with selected budgets for thinking levels
   */
  resolveThinkingBudgets(): Record<ModelThinkingLevel, number> {
    const settingsBudgets = this.settingsManager.getThinkingBudgets() ?? {};
    return {
      ...THINKING_BUDGETS,
      ...settingsBudgets,
    };
  }

  /**
   * Resolves whether the extension should react to model selection events.
   *
   * @returns `true` if the extension should load the model on model_select
   */
  async resolveReactToModelSelect(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).reactToModelSelect ??
      ReactToModelSelectSettingsItem.defaultValue
    );
  }

  /**
   * Resolves whether the extension should auto-load models on message.
   *
   * @returns `true` if the extension should auto-load models
   */
  async resolveAutoloadOnMessage(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).autoloadOnMessage ??
      AutoloadOnMessageSettingsItem.defaultValue
    );
  }

  /**
   * Resolves the timeout settings for polling and server checks.
   *
   * @returns Object with polling interval, polling timeout, and server timeout values
   */
  async resolveTimeouts(): Promise<{
    pollingInterval: number;
    pollingTimeout: number;
    serverTimeout: number;
  }> {
    const llamaSettings = await this.getLlamaSettings();
    return {
      pollingInterval:
        llamaSettings.pollingInterval ??
        PollingIntervalSettingsItem.defaultValue,
      pollingTimeout:
        llamaSettings.pollingTimeout ?? PollingTimeoutSettingsItem.defaultValue,
      serverTimeout:
        llamaSettings.serverTimeout ?? ServerTimeoutSettingsItem.defaultValue,
    };
  }

  /**
   * Resolves the maximum time (ms) for server verification and SSE probes.
   *
   * @returns The server timeout in ms
   */
  async resolveServerTimeout(): Promise<number> {
    return (await this.resolveTimeouts()).serverTimeout;
  }

  /**
   * Resolves the time (ms) between status checks during load/unload.
   *
   * @returns The polling interval in ms
   */
  async resolvePollingInterval(): Promise<number> {
    return (await this.resolveTimeouts()).pollingInterval;
  }

  /**
   * Resolves the maximum time (ms) to wait for model loading.
   *
   * @returns The polling timeout in ms
   */
  async resolvePollingTimeout(): Promise<number> {
    return (await this.resolveTimeouts()).pollingTimeout;
  }

  /**
   * Resolves the sort order for model lists.
   *
   * @returns The sort order: "asc", "desc", "asc-name", "desc-name", or "api"
   */
  async resolveSortBy(): Promise<SortBy> {
    return (
      (await this.getLlamaSettings()).sortBy ?? SortBySettingsItem.defaultValue
    );
  }

  /**
   * Resolves whether to show server URLs in the /models model list.
   *
   * @returns `true` if server URLs should be shown
   */
  async resolveShowServerUrls(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).showServerUrls ??
      ShowServerUrlsSettingsItem.defaultValue
    );
  }

  /**
   * Resolves whether SSE is enabled for model loading.
   *
   * @returns `true` if SSE should be used
   */
  async resolveEnableSSE(): Promise<boolean> {
    return (await this.getLlamaSettings()).enableSSE ?? true;
  }

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
   * Deletes from project `.pi/settings.json` if it exists, otherwise global.
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

  /**
   * Resolves the settings store: project if `.pi/settings.json` exists,
   * otherwise global `~/.pi/agent/settings.json`.
   */
  private async resolveStore(): Promise<SettingsStore> {
    return (await this.hasProjectSettings())
      ? this.projectStore
      : this.globalStore;
  }
}

/**
 * Creates a new LlamaSettingsManager instance.
 * Single wiring point for the extension's default collaborators.
 */
export function createSettingsManager(): LlamaSettingsManager {
  return new LlamaSettingsManager(SettingsManager.create(process.cwd()));
}
