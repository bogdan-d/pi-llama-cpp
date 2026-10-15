import { vi } from "vitest";
import { defaultBaseUrl } from "../constants";
import { PollingTimeoutSettingsItem } from "../../src/settings/items/pollingTimeout";
import { ServerTimeoutSettingsItem } from "../../src/settings/items/serverTimeout";
import type { ModelOverride } from "../../src/interfaces/settings";
import { makeResolverStub } from "./settings";
import { BaseModel } from "../../src/models/baseModel";
import { Server } from "../../src/server";

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
