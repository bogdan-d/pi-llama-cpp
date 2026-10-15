// layering trade-off: api client depends on settings/items to get the shared
// polling interval default — avoids duplicating the value across modules.
import { PollingIntervalSettingsItem } from "../settings/items/pollingInterval";

/**
 * Error thrown by the API client when the server rejects a request.
 */
export class ApiError extends Error {
  constructor(
    public readonly type: "authentication" | "server" | "unknown",
    public readonly statusCode: number,
  ) {
    super(`API error (${statusCode})`);
    this.name = "ApiError";
  }
}

/**
 * HTTP client for llama-server with GET caching and request deduplication.
 *
 * GETs are cached (TTL: half the live polling interval) and concurrent
 * duplicates share one in-flight promise. POSTs are deduplicated but never
 * cached. Raw/probe methods bypass both.
 */
export class ApiClient {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * Creates a new ApiClient.
   *
   * The key is resolved per request via `getApiKey`, so a client built once
   * picks up key changes (settings edits) without being rebuilt.
   *
   * @param baseUrl The base URL of the llama-server
   * @param getApiKey Resolves the API key for authentication at request time
   * @param getPollingInterval Resolves the current polling interval, which
   *   the cache TTL is derived from (half of it) at each GET request
   */
  constructor(
    private readonly baseUrl: string,
    private readonly getApiKey: () => string,
    private readonly getPollingInterval: () => Promise<number> = async () =>
      PollingIntervalSettingsItem.defaultValue,
  ) {}

  /**
   * Makes a cached, deduplicated GET request to the llama-server.
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The parsed JSON response from the server
   */
  async get<T>(endpoint: string, timeout?: number): Promise<T> {
    const cached = this.cacheGet<T>(endpoint);
    if (cached !== undefined) return cached;

    return this.dedupe(endpoint, async () => {
      const ttl = (await this.getPollingInterval()) / 2;
      const data = await this.do_get<T>(endpoint, timeout);
      this.cacheSet(endpoint, data, ttl);
      return data;
    });
  }

  /**
   * Makes a deduplicated POST request to the llama-server.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The parsed JSON response from the server
   */
  async post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    return this.dedupe(this.cacheKey(endpoint, body), async () =>
      this.do_post<T>(endpoint, body),
    );
  }

  /**
   * Makes a raw GET request that does not parse JSON.
   *
   * @param endpoint The endpoint path to fetch
   */
  async rawGet(endpoint: string): Promise<void> {
    return this.do_request<void>(endpoint, "GET", undefined, false);
  }

  /**
   * Makes a raw POST request that does not parse JSON.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   */
  async rawPost(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    return this.do_request<void>(endpoint, "POST", body, false);
  }

  /**
   * Makes a GET request that returns only the HTTP status code, without
   * parsing the body. Used by health probes, which classify on status and
   * error identity rather than payload.
   *
   * @param endpoint The endpoint path to probe (e.g. "/health")
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The HTTP status code
   * @throws ApiError with status 401 on authentication rejection (kept for
   *   symmetry with `do_request`, so auth classification needs no special case)
   */
  async probeStatus(endpoint: string, timeout: number): Promise<number> {
    const res = await this.fetchResponse(endpoint, "GET", undefined, timeout);
    if (res.status === 401) {
      throw new ApiError("authentication", res.status);
    }
    return res.status;
  }

  /**
   * Clears the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Runs `fn` for the given key, or returns an existing in-flight promise.
   *
   * @param key The dedup key
   * @param fn The request to run
   * @returns The shared promise for the key
   */
  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Gets a cached GET response.
   *
   * @param key The cache key
   * @returns The cached data, or `undefined` if missing or expired
   */
  private cacheGet<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Stores a GET response in the cache with a per-entry expiry.
   *
   * @param key The cache key
   * @param data The response data
   * @param ttl How long the entry stays fresh, in ms
   */
  private cacheSet(key: string, data: unknown, ttl: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  /**
   * Builds the dedup key for a POST request.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The dedup key
   */
  private cacheKey(endpoint: string, body?: Record<string, unknown>): string {
    return body ? `${endpoint}:${JSON.stringify(body)}` : endpoint;
  }

  /**
   * Performs the raw fetch for a request (cache/dedup live in the callers).
   *
   * @param endpoint The endpoint path
   * @param method The HTTP method
   * @param body The optional request body
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The raw response
   */
  private fetchResponse(
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    timeout?: number,
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const signal = timeout ? AbortSignal.timeout(timeout) : undefined;

    return fetch(url, {
      signal,
      method,
      headers: {
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined),
        Authorization: `Bearer ${this.getApiKey()}`,
      },
      ...(body ? { body: JSON.stringify(body) } : undefined),
    });
  }

  /**
   * Makes a raw request to the llama-server (no cache, no dedup).
   *
   * @param endpoint The endpoint path
   * @param method The HTTP method
   * @param body The optional request body
   * @param parseJson Whether to parse the response as JSON (default: true)
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The parsed JSON response, or void if parseJson is false
   * @throws ApiError with status 401 when the server rejects the request
   *   due to authentication (invalid/missing API key).
   */
  private async do_request<T>(
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    parseJson = true,
    timeout?: number,
  ): Promise<T | void> {
    const res = await this.fetchResponse(endpoint, method, body, timeout);

    if (res.status === 401) {
      throw new ApiError("authentication", res.status);
    }

    return parseJson ? ((await res.json()) as T) : (undefined as T);
  }

  /**
   * Raw GET variant of {@link do_request}.
   */
  private async do_get<T>(endpoint: string, timeout?: number): Promise<T> {
    return this.do_request<T>(
      endpoint,
      "GET",
      undefined,
      true,
      timeout,
    ) as Promise<T>;
  }

  /**
   * Raw POST variant of {@link do_request}.
   */
  private async do_post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return this.do_request<T>(endpoint, "POST", body) as Promise<T>;
  }
}
