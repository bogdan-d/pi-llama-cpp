import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import { defaultBaseUrl } from "./constants";
import { API_KEY_PLACEHOLDER, THINKING_BUDGETS } from "../src/constants";
import { AutoloadOnMessageSettingsItem } from "../src/settings/items/autoload-on-message";
import { PollingIntervalSettingsItem } from "../src/settings/items/polling-interval";
import { PollingTimeoutSettingsItem } from "../src/settings/items/polling-timeout";
import { ReactToModelSelectSettingsItem } from "../src/settings/items/react-to-model-select";
import { ServerTimeoutSettingsItem } from "../src/settings/items/server-timeout";
import { ShowServerUrlsSettingsItem } from "../src/settings/items/show-server-urls";
import { SortBySettingsItem } from "../src/settings/items/sort-by";
import { Mode } from "../src/enums/mode";
import { Status } from "../src/enums/status";
import type { ModelOverride } from "../src/interfaces/settings";
import type { ServerSettingsResolver } from "../src/interfaces/server";
import type { SettingsService } from "../src/settings/settings";
import { BaseModel } from "../src/models/baseModel";
import { Server } from "../src/server";

/** Shared mock RPC — each test configures it */
export const mockRpc = vi.fn();

/**
 * Hand-made stub of `SettingsService` for constructor injection —
 * replaces whole-module `vi.mock` blocks and per-case `vi.spyOn` on the
 * real singleton. Defaults give every consumer-used member a benign value;
 * a case that cares passes just that member as an override. The single
 * `as unknown as` cast lives here so test bodies stay cast-free.
 */
export const makeSettingsStub = (
  overrides: Partial<SettingsService> = {},
): SettingsService =>
  ({
    getLlamaSettings: vi.fn(async () => ({})),
    getLlamaServers: vi.fn(async () => []),
    resolveTimeouts: vi.fn(async () => ({
      pollingInterval: PollingIntervalSettingsItem.defaultValue,
      pollingTimeout: PollingTimeoutSettingsItem.defaultValue,
      serverTimeout: ServerTimeoutSettingsItem.defaultValue,
    })),
    resolveServerTimeout: vi.fn(
      async () => ServerTimeoutSettingsItem.defaultValue,
    ),
    resolvePollingInterval: vi.fn(
      async () => PollingIntervalSettingsItem.defaultValue,
    ),
    resolvePollingTimeout: vi.fn(
      async () => PollingTimeoutSettingsItem.defaultValue,
    ),
    resolveEnableSSE: vi.fn(async () => true),
    resolveServerConfigs: vi.fn(async () => []),
    resolveSortBy: vi.fn(async () => SortBySettingsItem.defaultValue),
    resolveShowServerUrls: vi.fn(
      async () => ShowServerUrlsSettingsItem.defaultValue,
    ),
    resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
    resolveReactToModelSelect: vi.fn(
      async () => ReactToModelSelectSettingsItem.defaultValue,
    ),
    resolveAutoloadOnMessage: vi.fn(
      async () => AutoloadOnMessageSettingsItem.defaultValue,
    ),
    resolveThinkingLevel: vi.fn(() => undefined),
    resolveThinkingBudgets: vi.fn(() => ({ ...THINKING_BUDGETS })),
    takeWarnings: vi.fn((): string[] => []),
    setLlamaSettings: vi.fn(() => Promise.resolve()),
    ...overrides,
  }) as unknown as SettingsService;

/**
 * Stub of the {@link ServerSettingsResolver} interface `Server`,
 * `SSEManager`, and `BaseModel` depend on. Defaults give every method a
 * benign value; a case that cares passes just that method as an override.
 */
export const makeResolverStub = (
  overrides: Partial<ServerSettingsResolver> = {},
): ServerSettingsResolver =>
  ({
    resolveServerTimeout: vi.fn(
      async () => ServerTimeoutSettingsItem.defaultValue,
    ),
    resolvePollingInterval: vi.fn(
      async () => PollingIntervalSettingsItem.defaultValue,
    ),
    resolvePollingTimeout: vi.fn(
      async () => PollingTimeoutSettingsItem.defaultValue,
    ),
    resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
    resolveEnableSSE: vi.fn(async () => true),
    ...overrides,
  }) as ServerSettingsResolver;

/**
 * Installs a global `fetch` stub that routes every request into the shared
 * `mockRpc`, keyed by the endpoint path + query (and parsed body for POSTs) —
 * the same contract the old fake clients used, so tests keep configuring
 * responses on `mockRpc`. Responses always come back as 200 JSON; SSE probes
 * therefore see a non-event-stream content type and fall back to polling.
 * Tests asserting raw fetch behavior (health classification, SSE streaming)
 * install their own stub instead, as before.
 */
export const installFetchStub = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const href =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const { pathname, search } = new URL(href);
        const endpoint = `${pathname}${search}`;
        // Only pass the body argument when present, so call assertions like
        // `toHaveBeenCalledWith("/v1/models")` match single-argument calls.
        const data =
          typeof init?.body === "string"
            ? await mockRpc(endpoint, JSON.parse(init.body))
            : await mockRpc(endpoint);
        return new Response(JSON.stringify(data ?? {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ),
  );
};

/**
 * Overrides for {@link createMockServer}. Identity (`baseUrl`/`customId`/
 * `customName`), `apiKey` and the timeout values are constructor wiring
 * (ServerOptions + a synthesized resolver stub) — a real Server has no
 * assignable properties by those names. Everything else is shadowed onto the
 * instance as-is (e.g. a custom `initialize`).
 */
export type MockServerOverrides = Partial<
  Omit<
    Server,
    | "baseUrl"
    | "providerId"
    | "providerName"
    | "pollingTimeout"
    | "serverTimeout"
    | "sseManager"
    | "models"
  >
> & {
  baseUrl?: string;
  customId?: string;
  customName?: string;
  apiKey?: string;
  models?: BaseModel[];
  pollingTimeout?: number;
  serverTimeout?: number;
  overrides?: Record<string, ModelOverride>;
};

/**
 * Builds a real `Server` wired with fake collaborators (`createFakeClients`),
 * replacing the old hand-rolled `Partial<Server>` mock whose `isReady` /
 * `initialize` re-implementations drifted from the real ones.
 *
 * Seeded `models` land directly in `server.models`; `initialize` is stubbed
 * to a no-op so a `ServerManager.update()` scan cannot wipe the seeds with
 * fetched data — pass an `initialize` override to restore the real flow.
 */
export const createMockServer = (
  overrides: MockServerOverrides = {},
): Server => {
  const {
    baseUrl,
    customId,
    customName,
    apiKey,
    models,
    pollingTimeout,
    serverTimeout,
    overrides: modelOverrides,
    initialize,
    ...members
  } = overrides;

  const resolver = makeResolverStub({
    ...(apiKey !== undefined && { resolveApiKey: vi.fn(() => apiKey) }),
    ...((pollingTimeout !== undefined || serverTimeout !== undefined) && {
      resolvePollingTimeout: vi.fn(
        async () => pollingTimeout ?? PollingTimeoutSettingsItem.defaultValue,
      ),
      resolveServerTimeout: vi.fn(
        async () => serverTimeout ?? ServerTimeoutSettingsItem.defaultValue,
      ),
    }),
  });

  const server = new Server(resolver, {
    baseUrl: baseUrl ?? defaultBaseUrl(),
    customId,
    customName,
    overrides: modelOverrides,
  });
  if (models) server.models.push(...models);
  return Object.assign(server, members, {
    initialize: initialize ?? (async () => {}),
  });
};

/**
 * Stubs `Server.prototype.initialize` so `Server` instances built by
 * `ServerManager.update()` (from `ServerOptions`) come out pre-populated —
 * replaces the old pattern of injecting pre-built mock servers through
 * `resolveServers`. The optional `seed` callback receives each server
 * (push models, wire a fake `sse` slot, etc.); remember to restore mocks
 * after the test (`vi.restoreAllMocks()`).
 */
export const stubInitialize = (seed?: (server: Server) => void) =>
  vi.spyOn(Server.prototype, "initialize").mockImplementation(async function (
    this: Server,
  ) {
    seed?.(this);
  });

/** Helper to create a mock BaseModel */
export const createMockModel = (
  name: string,
  overrides: Partial<BaseModel> = {},
): BaseModel =>
  ({
    name,
    id: name,
    mode: Mode.ROUTER,
    serverUrl: defaultBaseUrl(),
    capabilities: ["text"] as ["text"],
    getStatus: vi.fn().mockResolvedValue(Status.LOADED),
    getContextSize: vi.fn().mockResolvedValue(4096),
    getInfo: vi.fn().mockResolvedValue(`Model: ${name}\nID: ${name}`),
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    toProviderConfig: vi.fn().mockResolvedValue({}),
    getLabel: vi.fn().mockResolvedValue(name),
    ...overrides,
  }) as unknown as BaseModel;

/** Create a mock extension context */
export const createMockCtx = (
  selectFn: (prompt: string, options: string[]) => string | null,
) => ({
  mode: "tui",
  cwd: "/tmp/test",
  ui: {
    select: vi.fn(selectFn),
    notify: vi.fn(),
    custom: vi.fn(),
    theme: {
      fg: (_color: string, text: string) => text,
    },
  },
  modelRegistry: {
    find: vi.fn().mockReturnValue({ id: "test-model-id" }),
  },
});

/** Create a mock Pi instance */
export const createMockPi = () => ({
  setModel: vi.fn(),
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
});

/** Create a mock Pi context for EventManager */
export const createMockPiContext = (notifyFn: ReturnType<typeof vi.fn>) =>
  ({
    ui: {
      notify: notifyFn,
    },
  }) as any as ExtensionContext;
