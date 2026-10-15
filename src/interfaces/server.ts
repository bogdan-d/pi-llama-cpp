import type { ModelOverride } from "./settings";
import type { ModelsEndpoint } from "./endpoints/models";
import type { PropsModelEndpoint } from "./endpoints/props";

/**
 * Minimal server interface for {@link BaseModel}.
 * Decouples model classes from the concrete {@link Server} class,
 * breaking the circular dependency between models and server.
 */
export interface IServer {
  baseUrl: string;
  providerId: string;
  findOverrideForModel(modelId: string): ModelOverride | undefined;
  fetchModelProps(modelId: string): Promise<PropsModelEndpoint>;
  fetchModels(): Promise<ModelsEndpoint>;
  postRequest(path: "load" | "unload", model: string): Promise<ModelsEndpoint>;
  sseManager?: {
    probeSSE(): Promise<boolean>;
    subscribeToStatus(
      modelId: string,
    ): Promise<{ status: string; exit_code?: number }>;
  };
  llamaSwapLoad(model: string): Promise<void>;
  llamaSwapUnload(model: string): Promise<void>;
}

/**
 * Minimal settings resolver for {@link Server}, `SSEManager`, and
 * `BaseModel`. Decouples all components from `SettingsService` —
 * consumers depend on this interface, not on the settings service.
 * Implemented by `SettingsService`.
 */
export interface ServerSettingsResolver {
  /**
   * Maximum time (ms) for server verification and SSE support probe.
   */
  resolveServerTimeout(): Promise<number>;
  /**
   * Time (ms) between status checks during load/unload.
   */
  resolvePollingInterval(): Promise<number>;
  /**
   * Maximum time (ms) to wait for model loading before giving up.
   */
  resolvePollingTimeout(): Promise<number>;
  /**
   * Resolves the API key stored for a provider ID.
   */
  resolveApiKey(providerId: string): string;
  /**
   * Resolves whether SSE is enabled for model loading.
   */
  resolveEnableSSE(): Promise<boolean>;
}

/**
 * Identity of a llama.cpp server endpoint.
 *
 * Persisted counterpart: {@link LlamaServer} (`llamaSettings.servers`),
 * whose `url`/`id`/`name` map onto these fields.
 */
export interface ServerOptions {
  /**
   * Base URL of the llama.cpp server (e.g. "http://127.0.0.1:9931").
   */
  baseUrl: string;
  /**
   * Custom provider ID; falls back to a URL-based one.
   */
  customId?: string;
  /**
   * Custom provider name suffix; falls back to the base URL.
   */
  customName?: string;
  /**
   * Per-model overrides resolved from `llamaSettings.servers`. See
   * {@link ModelOverride} for the fallback semantics of each field.
   */
  overrides?: Record<string, ModelOverride>;
}
