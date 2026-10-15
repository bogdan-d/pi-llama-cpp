import type { SettingsItem } from "./base";
import { AutoloadOnMessageSettingsItem } from "./items/autoloadOnMessage";
import { EnableSSESettingsItem } from "./items/enableSse";
import { PollingIntervalSettingsItem } from "./items/pollingInterval";
import { PollingTimeoutSettingsItem } from "./items/pollingTimeout";
import { ReactToModelSelectSettingsItem } from "./items/reactToModelSelect";
import { ServerTimeoutSettingsItem } from "./items/serverTimeout";
import { ShowServerUrlsSettingsItem } from "./items/showServerUrls";
import { SortBySettingsItem } from "./items/sortBy";

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
