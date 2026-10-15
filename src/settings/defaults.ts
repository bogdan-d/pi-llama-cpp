import type { SettingsItem } from "./base";
import { AutoloadOnMessageSettingsItem } from "./items/autoload-on-message";
import { EnableSSESettingsItem } from "./items/enable-sse";
import { PollingIntervalSettingsItem } from "./items/polling-interval";
import { PollingTimeoutSettingsItem } from "./items/polling-timeout";
import { ReactToModelSelectSettingsItem } from "./items/react-to-model-select";
import { ServerTimeoutSettingsItem } from "./items/server-timeout";
import { ShowServerUrlsSettingsItem } from "./items/show-server-urls";
import { SortBySettingsItem } from "./items/sort-by";

/**
 * Registry of all scalar settings items for `/models settings`.
 * Instantiated at module load time; consumed by the settings menu.
 */
export const SETTINGS_ITEMS: Record<string, SettingsItem<unknown>> = {
  reactToModelSelect: new ReactToModelSelectSettingsItem(),
  autoloadOnMessage: new AutoloadOnMessageSettingsItem(),
  sortBy: new SortBySettingsItem(),
  pollingInterval: new PollingIntervalSettingsItem(),
  pollingTimeout: new PollingTimeoutSettingsItem(),
  serverTimeout: new ServerTimeoutSettingsItem(),
  showServerUrls: new ShowServerUrlsSettingsItem(),
  enableSSE: new EnableSSESettingsItem(),
};
