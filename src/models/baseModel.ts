import type { ModelCost } from "@earendil-works/pi-ai";
import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { DataProperty } from "../interfaces/endpoints/models";
import type { ChatModelConfig } from "../interfaces/chatModelConfig";
import type { ServerSettingsResolver } from "../interfaces/server";
import { Server } from "../server";

/**
 * Abstract base class for llama-server models.
 * Provides common functionality for model identification, status checking,
 * loading/unloading, and configuration conversion.
 */
export abstract class BaseModel {
  constructor(
    protected readonly model: DataProperty,
    protected readonly server: Server,
    protected readonly resolver: ServerSettingsResolver,
  ) {}

  protected readonly labelIcons: Record<Status, string> = {
    [Status.LOADED]: "🟢",
    [Status.LOADING]: "🟡",
    [Status.FAILED]: "🔴",
    [Status.SLEEPING]: "🔵",
    [Status.UNLOADED]: "⚪",
  };

  abstract get mode(): Mode;

  /**
   * Returns the server URL associated with this model
   */
  get serverUrl(): string {
    return this.server.baseUrl;
  }

  /**
   * Returns the provider id associated with this model
   */
  get serverId(): string {
    return this.server.providerId;
  }

  /**
   * Returns the model's unique identifier
   */
  get id(): string {
    return this.model.id;
  }

  /**
   * Returns the model's display name (first alias, or id as fallback)
   */
  get name(): string {
    return this.model.aliases?.[0] || this.model.id;
  }

  /**
   * Whether the model is a reasoning model.
   * An override's `reasoning` wins; otherwise defaults to `true`, since
   * there's no way to detect this from llama-server.
   */
  get reasoning(): boolean {
    return this.server.findOverrideForModel(this.id)?.reasoning ?? true;
  }

  /**
   * Detects the capabilities of the model.
   * An override's `capabilities` fully replaces detection; otherwise the
   * model's modalities are probed from the server.
   *
   * @returns An array of capabilities, as expected by Pi
   */
  protected async getCapabilities(): Promise<("text" | "image")[]> {
    const overridden = this.server.findOverrideForModel(this.id)?.capabilities;
    if (overridden) return overridden;

    try {
      // When loaded, this works alright
      const { modalities } = await this.server.fetchModelProps(this.id);
      return modalities.vision ? ["text", "image"] : ["text"];
    } catch {
      // Otherwise, we have to search for it ourselves
      const { data } = await this.server.fetchModels();
      const model = data.find((d) => d.id === this.id);
      if (!model) return ["text"];

      const input_modalities: ("text" | "image" | "audio")[] = model
        .architecture?.input_modalities ?? ["text"];

      const response = input_modalities.filter(
        (mod): mod is "text" | "image" => mod === "text" || mod === "image",
      );

      return response;
    }
  }

  /**
   * Gets the load status of the model
   *
   * @returns The current {@link Status}
   */
  public async getStatus(): Promise<Status> {
    try {
      const { is_sleeping, error } = await this.server.fetchModelProps(this.id);

      if (is_sleeping) return Status.SLEEPING;
      if (!error) return Status.LOADED;
      if (error.code === 503) return Status.LOADING;
      if (error.code === 400 && error.message === "model is not loaded")
        return Status.UNLOADED;

      return Status.FAILED;
    } catch (err) {
      return Status.FAILED;
    }
  }

  /**
   * Gets the context size of a particular model.
   *
   * An override's `contextSize` (when set and `> 0`) replaces detection;
   * otherwise the value is autodetected from the server, falling back to
   * {@link FALLBACK_CTX}. A stored `0` behaves as if the key were absent.
   *
   * @returns The context size in tokens
   */
  protected async getContextSize(): Promise<number> {
    const overridden = this.server.findOverrideForModel(this.id)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    try {
      const { data } = await this.server.fetchModels();
      const n_ctx = data.find((m) => m.id === this.id)?.meta?.n_ctx;
      return n_ctx ?? FALLBACK_CTX;
    } catch {
      return FALLBACK_CTX;
    }
  }

  /**
   * Returns a label for the model selection screen
   * @returns A label structured as "<icon> <name>"
   */
  async getLabel(): Promise<string> {
    const status = await this.getStatus();
    return `${this.labelIcons[status]} ${this.name}`;
  }

  /**
   * Returns human-readable information about the model
   * @returns A string with the model information
   */
  async getInfo(): Promise<string> {
    const messages = [
      `Server       : ${this.serverUrl}`,
      `ID           : ${this.id}`,
      `Model        : ${this.name}`,
      `Reasoning    : ${this.reasoning}`,
      `Capabilities : ${(await this.getCapabilities()).join(", ")}`,
      `Context size : ${await this.getContextSize()}`,
      `Status       : ${await this.getStatus()}`,
    ];

    const response = `${messages.join("\n")}\n`;
    return response;
  }

  /**
   * Converts the llama-server model into a configuration object used by Pi
   *
   * @returns A Pi configuration object
   */
  async toProviderConfig(): Promise<ChatModelConfig> {
    const override = this.server.findOverrideForModel(this.id) ?? {};

    // Merge the matched override's cost with zero defaults
    const userCost = override.cost ?? {};
    const cost: ModelCost = {
      input: userCost.input ?? 0,
      output: userCost.output ?? 0,
      cacheRead: userCost.cacheRead ?? 0,
      cacheWrite: userCost.cacheWrite ?? 0,
    };

    const input = await this.getCapabilities();
    const contextWindow = await this.getContextSize();
    const maxTokens = this.getMaxTokens(contextWindow);

    const response: ChatModelConfig = {
      id: this.id,
      name: this.name,
      reasoning: this.reasoning,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      input,
      contextWindow,
      cost,
      maxTokens,
    };

    // Add compat if the override specifies it
    if (override.compat) {
      response.compat = override.compat;
    }

    return response;
  }

  /**
   * Gets the maximum number of tokens the model can generate.
   *
   * An override's `maxTokens` (when set and `> 0`) replaces the value;
   * otherwise it falls back to the context size — a model cannot generate
   * more tokens than its context holds. A stored `0` behaves as if the
   * key were absent.
   *
   * @param contextSize - The already-resolved context size, used as fallback
   * @returns The maximum number of tokens
   */
  protected getMaxTokens(contextSize: number): number {
    const overridden = this.server.findOverrideForModel(this.id)?.maxTokens;
    return overridden && overridden > 0 ? overridden : contextSize;
  }

  /**
   * Loads the model in llama-server.
   * Uses SSE status events when available, falling back to polling.
   */
  async load(): Promise<void> {
    const status = await this.getStatus();
    if (status === Status.LOADED || status === Status.SLEEPING) return;

    await this.server.postRequest("load", this.id);

    if (await this.server.sseManager.probeSSE()) {
      try {
        const { status, exit_code } =
          await this.server.sseManager.subscribeToStatus(this.id);

        if (status === "failed" || (status === "unloaded" && exit_code !== 0)) {
          throw new Error(`Model loading failed: ${this.id}`);
        }
      } catch (err) {
        // A real failed status from the server stays fatal.
        if (
          err instanceof Error &&
          err.message.startsWith("Model loading failed")
        ) {
          throw err;
        }
        // An SSE timeout or connection failure is not proof the load failed:
        // subscribeToStatus timers are only cleared by a terminal event on
        // the same SSE connection, so a timer orphaned by a server restart
        // or reconnect can fire during a later, healthy load. Check the
        // model's real status over HTTP before surfacing an error.
        await this.pollStatus(Status.LOADED);
        const finalStatus = await this.getStatus();
        if (finalStatus !== Status.LOADED && finalStatus !== Status.SLEEPING) {
          throw new Error(`Model loading failed: ${this.id}`);
        }
      }
    } else {
      await this.pollStatus(Status.LOADED);
    }
  }

  /**
   * Unloads the model from llama-server and waits until the status
   * reaches `UNLOADED`.
   */
  async unload(): Promise<void> {
    await this.server.postRequest("unload", this.id);
    await this.pollStatus(Status.UNLOADED);
  }

  /**
   * Polls llama-server until the model reaches the expected status.
   *
   * @param expected The status to wait for
   */
  protected async pollStatus(expected: Status): Promise<void> {
    const startTime = Date.now();
    const timeout = await this.resolver.resolvePollingTimeout();
    const interval = await this.resolver.resolvePollingInterval();

    let current: Status;
    do {
      // Timeout on polling
      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Model ${expected} timed out after ${timeout} ms: ${this.id}`,
        );
      }

      await new Promise((r) => setTimeout(r, interval));
      current = await this.getStatus();

      // Short-circuit when server didn't load at all
      if (expected === Status.LOADED && current === Status.UNLOADED) {
        throw new Error(`Model loading failed: ${this.id}`);
      }
    } while (current !== expected);
  }
}
