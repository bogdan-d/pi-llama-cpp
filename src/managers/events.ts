import { hasApi } from "@earendil-works/pi-ai";
import {
  type BeforeProviderRequestEvent,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { READABLE_TIMEOUT } from "../constants";
import { Status } from "../enums/status";
import { ModelSelectEvent } from "../interfaces/events";
import type { LlamaSettingsManager } from "../managers/settings";
import { BaseModel } from "../models/baseModel";
import { ServerManager } from "./server";

export class EventManager {
  /**
   * Model with a load currently in flight. Deliberately a class static:
   * the load is started by CommandManager
   * (fire-and-forget from the /models editor) while the "session switched
   * mid-load" warning must be emitted here, from the session_before_switch
   * hook — a shared static is the least-plumbing bridge between the two
   * event-owning managers.
   *
   * Known limits, accepted: (1) single slot — a second overlapping load
   * overwrites the first, and the first load's onFinished reset can clear
   * the flag while the second is still loading, so the session-switch
   * warning may be missed; (2) loads initiated from this class
   * (onModelSelect / autoLoadIfNeeded) never set the flag.
   */
  static inflightModel: BaseModel | null = null;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly settings: LlamaSettingsManager,
  ) {}

  /**
   * Resets the in-flight model reference. Called by CommandManager when
   * its load settles (see `inflightModel` for why this lives on a static).
   */
  static resetInflightModel() {
    EventManager.inflightModel = null;
  }

  /**
   * Reacts to a new model event triggered by Pi
   *
   * @param event Model selection event
   * @param ctx Pi context
   */
  async onModelSelect(event: ModelSelectEvent, ctx: ExtensionContext) {
    // Check if the model_select event should be used
    if (!(await this.settings.resolveReactToModelSelect())) return;

    for (const { providerId, models } of this.serverManager.servers) {
      if (event.model.provider !== providerId) continue;

      const model = models.find((m) => m.id === event.model.id);
      if (!model) continue;

      ctx.ui.notify(`Loading ${model.name}...`, "info");
      await model
        .load()
        .then(() => ctx.ui.notify(`Model ${model.name} ready`, "info"))
        .catch(() =>
          ctx.ui.notify(`Failed to load model ${model.name}`, "error"),
        );
      return;
    }
  }

  /**
   * Loads the model if auto-loading is enabled and the model is unloaded.
   *
   * @param model The model to potentially auto-load
   */
  private async autoLoadIfNeeded(model: BaseModel): Promise<void> {
    if (!(await this.settings.resolveAutoloadOnMessage())) return;

    const status = await model.getStatus();
    if (status !== Status.UNLOADED) return;

    await model.load();
  }

  /**
   * Session-switch handler. Registered once at extension init.
   * Only notifies if a model load is actually in-flight.
   *
   * @param ctx Pi context
   */
  async onSessionBeforeSwitch(ctx: ExtensionContext) {
    if (!EventManager.inflightModel) return;

    const messages = [
      `Session change detected while model '${EventManager.inflightModel.name}' was still loading.`,
      "Model load will continue in the background, but UI might not update.",
      "",
      "Verify that your new model is loaded, or use /models to re-select it afterwards.",
    ];
    ctx.ui.notify(messages.join("\n"), "warning");

    // Show the notification for a reasonable amount of time
    await new Promise((r) => setTimeout(r, READABLE_TIMEOUT));
  }

  /**
   * Intercepts the request to add extra information, useful to llama.cpp.
   * Adds a custom thinking budget to the request payload.
   *
   * @param event Request event
   * @returns Updated payload
   */
  async onBeforeProviderRequest(
    event: BeforeProviderRequestEvent,
    ctx: ExtensionContext,
  ) {
    if (
      typeof event.payload !== "object" ||
      event.payload === null ||
      Array.isArray(event.payload)
    )
      return event.payload;
    const payload = event.payload as Record<string, unknown>;
    const { model } = payload;
    if (typeof model !== "string" || !model) return payload;

    const server = this.serverManager.servers.find(
      (s) =>
        (!ctx.model || s.providerId === ctx.model.provider) &&
        s.models.some((m) => m.id === model),
    );
    const serverModel = server?.models.find((m) => m.id === model);

    if (!server || !serverModel) return payload;

    // Auto-load if enabled and model is unloaded
    await this.autoLoadIfNeeded(serverModel);

    // Pi has already serialized explicit thinking overrides. Do not add a
    // competing llama.cpp format or replace Pi's clamped token budget.
    const override = server.findOverrideForModel(model);
    const activeModel =
      ctx.model?.id === model && hasApi(ctx.model, "openai-completions")
        ? ctx.model
        : undefined;
    const compat = activeModel?.compat ?? override?.compat;
    if (
      (activeModel?.reasoning ?? override?.reasoning) === false ||
      compat?.thinkingFormat !== undefined ||
      compat?.chatTemplateKwargs !== undefined ||
      compat?.chatTemplateArgs !== undefined ||
      compat?.thinkingTokenBudgetField !== undefined ||
      compat?.supportsThinkingTokenBudget !== undefined
    )
      return payload;

    // Retrieve pi's current thinking level, so we can setup a budget
    const level =
      ctx.thinkingLevel ?? this.settings.resolveThinkingLevel() ?? "medium";
    const budgets = this.settings.resolveThinkingBudgets();
    const thinking_budget_tokens = budgets[level];

    // Setup payload
    if (level === "off") {
      const kwargs = payload.chat_template_kwargs;
      return {
        ...payload,
        chat_template_kwargs: {
          ...(typeof kwargs === "object" &&
          kwargs !== null &&
          !Array.isArray(kwargs)
            ? kwargs
            : {}),
          enable_thinking: false,
        },
      };
    }

    if (level === "max") return payload;

    return { ...payload, thinking_budget_tokens };
  }
}
