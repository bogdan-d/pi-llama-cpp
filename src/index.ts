import {
  type BeforeProviderRequestEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionBeforeSwitchEvent,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "./constants";
import { ModelSelectEvent } from "./interfaces/events";
import { CommandManager } from "./managers/command";
import { EventManager } from "./managers/events";
import { ServerManager } from "./managers/server";
import { settings } from "./managers/settings";
import { StatsManager } from "./managers/stats";

export default async function (pi: ExtensionAPI) {
  const serverManager = new ServerManager(settings);
  const eventManager = new EventManager(serverManager, settings);
  const commandManager = new CommandManager(serverManager, settings);
  const statsManager = new StatsManager(() =>
    serverManager.servers.map((server) => server.baseUrl),
  );

  // Register providers once at startup
  await serverManager.initialize(pi);

  // Wire up prompt-processing progress (fetch interception + UI updates)
  statsManager.initialize(pi);

  // Single global /models command
  pi.registerCommand("models", {
    description: `Browse ${PROVIDER_NAME} models`,
    getArgumentCompletions: commandManager.getArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await commandManager.handleCommand(args, ctx, pi);
    },
  });

  // Events
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason !== "startup") return;
    for (const warning of serverManager.getWarnings())
      ctx.ui.notify(warning, "warning");
  });

  pi.on(
    "before_provider_request",
    async (event: BeforeProviderRequestEvent, ctx: ExtensionContext) =>
      await eventManager.onBeforeProviderRequest(event, ctx),
  );

  pi.on(
    "model_select",
    async (event: ModelSelectEvent, ctx: ExtensionContext) =>
      await eventManager.onModelSelect(event, ctx),
  );
  pi.on(
    "session_before_switch",
    async (_: SessionBeforeSwitchEvent, ctx: ExtensionContext) =>
      await eventManager.onSessionBeforeSwitch(ctx),
  );
}
