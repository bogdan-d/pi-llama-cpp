import { ApiClient, ApiError } from "./api/client";
import {
  API_KEY_PLACEHOLDER,
  ENDPOINT_PREFIX,
  PROVIDER_NAME,
} from "./constants";
import { Mode } from "./enums/mode";
import { ServerStatus } from "./enums/serverStatus";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import {
  LlamaSwapPropsError,
  PropsEndpoint,
  PropsModelEndpoint,
} from "./interfaces/endpoints/props";
import type {
  IServer,
  ServerOptions,
  ServerSettingsResolver,
} from "./interfaces/server";
import type { ModelOverride } from "./interfaces/settings";
import { BaseModel } from "./models/baseModel";
import { LegacyModel } from "./models/legacyModel";
import { LlamaSwapModel } from "./models/llamaSwapModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";
import { SSEManager } from "./sse/manager";
import { detectMode } from "./utils/detectMode";
import { ServerIds } from "./utils/serverIds";

/** True when the error is a fetch timeout (either AbortSignal error name). */
const isTimeout = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === "TimeoutError" || err.name === "AbortError");

export class Server implements IServer {
  public readonly models: BaseModel[] = [];
  private readonly apiClient: ApiClient;
  private sse?: SSEManager;

  constructor(
    private readonly resolver: ServerSettingsResolver,
    private readonly options: ServerOptions,
    apiClient?: ApiClient,
    private readonly fetchFn: typeof globalThis.fetch = fetch,
  ) {
    // Eager client: `isReady` may run before `initialize()` (health probing
    // in ServerManager), so no lazy fallback is needed. The key is resolved
    // per request, so the client never needs rebuilding when it changes.
    this.apiClient =
      apiClient ??
      new ApiClient(
        options.baseUrl,
        () => this.apiKey,
        () => this.resolver.resolvePollingInterval(),
        this.fetchFn,
      );
  }

  /** Base URL of this server endpoint. */
  get baseUrl(): string {
    return this.options.baseUrl;
  }

  /**
   * Base URL of the OpenAI-compatible API: {@link baseUrl} joined with
   * {@link ENDPOINT_PREFIX}. Idempotent — a baseUrl that already ends with
   * the prefix is returned untouched, so proxied setups exposing the API
   * under a /v1 path don't double up.
   */
  get apiBaseUrl(): string {
    const { baseUrl } = this.options;
    return baseUrl.endsWith(ENDPOINT_PREFIX)
      ? baseUrl
      : `${baseUrl}${ENDPOINT_PREFIX}`;
  }

  /**
   * Provides access to the SSE manager for direct subscriptions.
   * Only available after {@link initialize} has been called.
   */
  get sseManager(): SSEManager | undefined {
    return this.sse;
  }

  /**
   * Overrides the SSE disconnect handler. Used by tests to verify
   * disconnect behavior without a real SSE connection.
   */
  setSseDisconnect(disconnect: () => void): void {
    this.sse!.disconnect = disconnect;
  }

  /**
   * Sets the SSE manager. Used by tests to inject a pre-configured
   * instance so `sseManager` is available before `initialize()`.
   */
  setSseManager(sseManager: SSEManager): void {
    this.sse = sseManager;
  }

  /**
   * Generates a unique provider ID from a server URL.
   * Uses custom ID if provided, otherwise falls back to URL-based ID.
   */
  get providerId(): string {
    return ServerIds.resolve(this.baseUrl, this.options.customId);
  }

  /**
   * Generates a human-readable provider name from a server URL.
   * Uses custom name as suffix if provided.
   */
  get providerName(): string {
    if (this.options.customName) {
      return `${PROVIDER_NAME} (${this.options.customName})`;
    }
    return `${PROVIDER_NAME} (${this.baseUrl})`;
  }

  /**
   * Retrieves the API key from the injected settings resolver.
   * Tries custom ID first, then falls back to URL-based ID.
   */
  get apiKey(): string {
    // Try custom ID first
    if (this.options.customId) {
      const key = this.resolver.resolveApiKey(this.options.customId);
      if (key !== API_KEY_PLACEHOLDER) return key;
    }
    // Fall back to URL-based ID
    return this.resolver.resolveApiKey(ServerIds.fromUrl(this.baseUrl));
  }

  /**
   * Fetches models from the server and populates {@link models}.
   * Clears the cache first so we always fetch fresh data.
   */
  async initialize(): Promise<void> {
    this.sse?.disconnect();
    this.sse = new SSEManager(this, this.resolver);

    const [{ data }, props] = await Promise.all([
      this.fetchModels(),
      this.fetchServerProps().catch(() => ({}) as PropsEndpoint),
    ]);

    const mode = detectMode(props, data);

    // Setup models
    const modelCtor = {
      [Mode.ROUTER]: RouterModel,
      [Mode.LEGACY]: LegacyModel,
      [Mode.SINGLE]: SingleModel,
      [Mode.LLAMASWAP]: LlamaSwapModel,
    }[mode];

    const models: BaseModel[] = data.map(
      (m) => new modelCtor(m, this, this.resolver),
    );

    this.models.length = 0;
    this.models.push(...models);
  }

  /**
   * Checks if the server is ready, with a timeout.
   *
   * Runs the health and auth probes concurrently through this server's
   * `ApiClient` — the auth probe warms the cache, so a subsequent
   * `initialize()` gets `/v1/models` from it instead of the network
   * (one network call per server per scan).
   *
   * @param timeout Maximum time to wait for the health check
   * @returns The server status
   */
  async isReady(timeout: number): Promise<ServerStatus> {
    return Server.probe(timeout, this.apiClient);
  }

  /**
   * Stateless health check for callers without a `Server` instance (editor
   * UIs probing draft URLs). Same classification as {@link isReady}, but
   * with a throwaway `ApiClient` — nothing is cached.
   *
   * @param url The bare origin of the llama-server
   * @param timeout Maximum time (ms) for both probes
   * @param apiKey Optional API key, sent as a Bearer token
   * @returns The classified server status
   */
  static async check(
    url: string,
    timeout: number,
    apiKey?: string,
    fetchFn?: typeof globalThis.fetch,
  ): Promise<ServerStatus> {
    return Server.probe(
      timeout,
      new ApiClient(url, () => apiKey ?? "", undefined, fetchFn),
    );
  }

  /**
   * Shared probe: classifies health (`/health`, status-code based) and auth
   * (`/v1/models`) concurrently.
   *
   * - Health fails (timeout)  → `TIMEOUT`
   * - Health fails (other)    → `UNREACHABLE`
   * - Health 200 + auth 401   → `UNAUTHORIZED`
   * - Health 200 + auth fails → `TIMEOUT` / `UNREACHABLE`
   * - Both OK                 → `READY`
   *
   * @param timeout Maximum time (ms) for both probes
   * @param client The client to probe with
   * @returns The classified server status
   */
  private static async probe(
    timeout: number,
    client: ApiClient,
  ): Promise<ServerStatus> {
    const [health, auth] = await Promise.allSettled([
      client.probeStatus("/health", timeout),
      client.get(`${ENDPOINT_PREFIX}/models`, timeout),
    ]);

    if (health.status === "rejected") {
      return isTimeout(health.reason)
        ? ServerStatus.TIMEOUT
        : ServerStatus.UNREACHABLE;
    }
    if (health.value !== 200) {
      return ServerStatus.UNREACHABLE;
    }

    if (auth.status === "rejected") {
      if (
        auth.reason instanceof ApiError &&
        auth.reason.type === "authentication"
      ) {
        return ServerStatus.UNAUTHORIZED;
      }
      return isTimeout(auth.reason)
        ? ServerStatus.TIMEOUT
        : ServerStatus.UNREACHABLE;
    }

    return ServerStatus.READY;
  }

  /**
   * Fetches models from the server
   *
   * @return The models from the server
   */
  async fetchModels(): Promise<ModelsEndpoint> {
    return await this.apiClient.get<ModelsEndpoint>(
      `${ENDPOINT_PREFIX}/models`,
    );
  }

  /**
   * Fetches general properties of the server.
   * llama-server returns {@link PropsEndpoint}; llama-swap returns
   * {@link LlamaSwapPropsError} (an error response with a `src` discriminator).
   *
   * @return The server properties
   */
  async fetchServerProps(): Promise<PropsEndpoint | LlamaSwapPropsError> {
    return await this.apiClient.get<PropsEndpoint | LlamaSwapPropsError>(
      "/props?autoload=false",
    );
  }

  /**
   * Fetches properties of a specific model from the server
   *
   * @param modelId The ID of the model
   * @return The properties of the specified model
   */
  async fetchModelProps(modelId: string): Promise<PropsModelEndpoint> {
    return await this.apiClient.get<PropsModelEndpoint>(
      `/props?model=${modelId}&autoload=false`,
    );
  }

  /**
   * Resolves the override for a given model ID using prefix matching.
   *
   * Keys in the overrides map are treated as prefix filters — a model ID
   * matches if it starts with the key. When multiple keys match, the
   * longest (most specific) key wins. Empty keys are ignored.
   *
   * @param modelId — The model ID to look up.
   * @returns The matching override, or `undefined` if no key matches.
   */
  findOverrideForModel(modelId: string): ModelOverride | undefined {
    const overrides = this.options.overrides ?? {};
    let best: ModelOverride | undefined;
    let bestLen = 0;

    for (const [key, override] of Object.entries(overrides)) {
      if (!key) continue;
      if (modelId.startsWith(key) && key.length > bestLen) {
        best = override;
        bestLen = key.length;
      }
    }

    return best;
  }

  /**
   * Sends a request associated to a specific model from the server
   *
   * @param resource The specified resource ("load" | "unload")
   * @param model The targeted model
   */
  async postRequest(
    resource: "load" | "unload",
    model: string,
  ): Promise<ModelsEndpoint> {
    this.apiClient.clearCache();
    return await this.apiClient.post<ModelsEndpoint>(`/models/${resource}`, {
      model,
    });
  }

  /**
   * Loads a model on a llama-swap server (GET /upstream/{id}).
   *
   * @param model The model ID to load
   */
  async llamaSwapLoad(model: string): Promise<void> {
    this.apiClient.clearCache();
    await this.apiClient.rawGet(`/upstream/${model}`);
  }

  /**
   * Unloads a model on a llama-swap server (POST /api/models/unload/{id}).
   *
   * @param model The model ID to unload
   */
  async llamaSwapUnload(model: string): Promise<void> {
    this.apiClient.clearCache();
    await this.apiClient.rawPost(`/api/models/unload/${model}`);
  }
}
