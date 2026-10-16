import { vi } from "vitest";
import { defaultBaseUrl } from "../constants";
import { PollingTimeoutSettingsItem } from "../../src/settings/items/pollingTimeout";
import { ServerTimeoutSettingsItem } from "../../src/settings/items/serverTimeout";
import type { ServerSettingsResolver } from "../../src/interfaces/server";
import type { ServerOptions } from "../../src/interfaces/server";
import { SSEManager } from "../../src/sse/manager";
import { makeResolverStub } from "./settings";
import { BaseModel } from "../../src/models/baseModel";
import { Server } from "../../src/server";

/** Default resolver stub — omit the resolver argument to use this. */
const defaultResolver = makeResolverStub({
  resolveApiKey: vi.fn(() => "sk-placeholder"),
  resolvePollingTimeout: vi.fn(
    async () => PollingTimeoutSettingsItem.defaultValue,
  ),
  resolveServerTimeout: vi.fn(
    async () => ServerTimeoutSettingsItem.defaultValue,
  ),
});

/** Sentinel — omit the resolver (uses a no-op stub). */
export const mockResolver: ServerSettingsResolver = defaultResolver;

/** Sentinel — omit the options (uses a default baseUrl). */
export const mockServerOptions = {} as Partial<ServerOptions>;

/**
 * Builds a real `Server` wired with fake collaborators,
 * replacing the old hand-rolled `Partial<Server>` mock whose `isReady` /
 * `initialize` re-implementations drifted from the real ones.
 *
 * Mirrors the real `Server` constructor `(resolver, options)` and adds:
 * - `models` — seeded after construction (like a real scan would do)
 * - `overrides` — post-construction property overrides (e.g. custom `initialize`)
 *
 * If `resolver` is omitted a no-op stub is used — tests that need custom
 * apiKey / timeouts should pass their own via `makeResolverStub`.
 */
export const createMockServer = (
  resolver?: ServerSettingsResolver,
  options?: Partial<ServerOptions>,
  models?: BaseModel[],
  overrides?: Partial<Server>,
  sse?: { disconnect: () => void },
): Server => {
  const effectiveResolver = resolver ?? defaultResolver;

  const server = new Server(effectiveResolver, {
    baseUrl: options?.baseUrl ?? defaultBaseUrl(),
    customId: options?.customId,
    customName: options?.customName,
    overrides: options?.overrides,
  });
  if (models) server.models.push(...models);
  // Create an SSEManager so `server.sseManager` is available for tests
  // that call `probeSSE()` etc. — initialize() would do this in real code.
  server["sse"] = new SSEManager(server, effectiveResolver);
  // Stub initialize to a no-op so seeded models aren't overwritten by
  // network fetches — tests that need the real flow pass an override.
  server.initialize = overrides?.initialize ?? (async () => {});
  if (sse) {
    const sseManager = server["sse"] as SSEManager;
    sseManager.disconnect = sse.disconnect;
  }
  return Object.assign(server, overrides, {
    initialize: server.initialize,
  });
};

/**
 * Convenience: create a seeded server with the default resolver —
 * the most common test pattern.
 */
export const createTestServer = (
  baseUrl: string,
  models: BaseModel[],
  disconnects?: () => void,
): Server =>
  createMockServer(mockResolver, { baseUrl }, models, undefined, {
    disconnect: disconnects!,
  });
