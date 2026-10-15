import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerOptions } from "../../src/interfaces/server";
import { ServerManager } from "../../src/managers/server";
import { BaseModel } from "../../src/models/baseModel";
import { createMockModel } from "../mocks/model";
import { makeSettingsStub } from "../mocks/settings";
import { mockRpc } from "../mocks/rpc";
import { stubInitialize } from "../mocks/server";

// Injected settings stub — the single instance passed to ServerManager and
// to every `Server` it constructs (the manager injects it as the settings
// resolver). Tests re-stub members per case instead of module-mocking the
// singleton.
const settingsStub = makeSettingsStub();

const mockPi = {
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
  registerCommand: vi.fn(),
  setModel: vi.fn(),
};

/** ServerOptions for a baseUrl — the shape `resolveServerConfigs` yields. */
const configOf = (
  baseUrl: string,
  extra: Partial<ServerOptions> = {},
): ServerOptions => ({ baseUrl, ...extra });

/**
 * Stubs `Server.prototype.initialize` to seed `modelsByUrl` into every
 * freshly constructed `Server` (keyed by baseUrl), optionally attaching a
 * per-server fake `sse` slot whose `disconnect` is the recorded mock —
 * mirroring an initialized server.
 */
const seedServers = (
  modelsByUrl: Record<string, BaseModel[]>,
  disconnectByUrl?: Record<string, ReturnType<typeof vi.fn>>,
) =>
  stubInitialize((server) => {
    server.models.push(...(modelsByUrl[server.baseUrl] ?? []));
    const disconnect = disconnectByUrl?.[server.baseUrl];
    if (disconnect) (server as any).sse = { disconnect };
  });

/**
 * Creates a ServerManager whose list is driven by the mocked
 * `settings.resolveServerConfigs()` — the same path a real scan takes.
 */
const createManager = async (
  ...configs: ServerOptions[]
): Promise<ServerManager> => {
  vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue(configs);
  const manager = new ServerManager(settingsStub);
  await manager.update(mockPi as any);
  return manager;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockImplementation((endpoint: string, fallback?: unknown) => {
    const defaults: Record<string, unknown> = {
      "/health": { status: "ok" },
      "/props?autoload=false": { role: "router" },
      "/v1/models": { data: [], object: "list" },
    };
    return Promise.resolve(defaults[endpoint] ?? fallback ?? {});
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServerManager", () => {
  it("should register providers for all servers", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    } as unknown as BaseModel;
    vi.mocked(settingsStub.resolveApiKey).mockImplementation((id) =>
      id.includes("9931") ? "key-1" : "key-2",
    );
    seedServers({
      "http://127.0.0.1:9931": [mockModel],
      "http://127.0.0.1:8081": [mockModel],
    });
    await createManager(
      configOf("http://127.0.0.1:9931"),
      configOf("http://127.0.0.1:8081"),
    );

    expect(mockPi.registerProvider).toHaveBeenCalledTimes(2);
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:9931",
      {
        name: "Llama.cpp (http://127.0.0.1:9931)",
        baseUrl: "http://127.0.0.1:9931/v1",
        api: "openai-completions",
        apiKey: "key-1",
        models: [{ id: "test-model" }],
      },
    );
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:8081",
      {
        name: "Llama.cpp (http://127.0.0.1:8081)",
        baseUrl: "http://127.0.0.1:8081/v1",
        api: "openai-completions",
        apiKey: "key-2",
        models: [{ id: "test-model" }],
      },
    );
  });

  it("should return all models from all servers", async () => {
    seedServers({
      "http://127.0.0.1:9931": [createMockModel("model-1")],
      "http://127.0.0.1:8081": [createMockModel("model-2")],
    });
    const manager = await createManager(
      configOf("http://127.0.0.1:9931"),
      configOf("http://127.0.0.1:8081"),
    );

    const allModels = await manager.getAllModels();

    expect(allModels).toHaveLength(2);
    expect(allModels.map((m) => m.id)).toEqual(["model-1", "model-2"]);
  });

  describe("live server list (re-derived from settings)", () => {
    it("should register servers added after the first scan", async () => {
      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-1", {
            serverUrl: "http://127.0.0.1:9931",
          }),
        ],
        "http://127.0.0.1:8081": [
          createMockModel("model-2", {
            serverUrl: "http://127.0.0.1:8081",
          }),
        ],
      });
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      const manager = new ServerManager(settingsStub);
      await manager.update(mockPi as any);
      expect(manager.servers).toHaveLength(1);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:8081/v1" }),
      );
      expect(manager.servers).toHaveLength(2);
      const models = await manager.getAllModels();
      expect(models.map((m) => m.id)).toEqual(["model-1", "model-2"]);
    });

    it("should unregister and disconnect removed servers on the next scan", async () => {
      const disconnectKept = vi.fn();
      const disconnectRemoved = vi.fn();
      seedServers(
        {
          "http://127.0.0.1:9931": [
            createMockModel("model-1", {
              serverUrl: "http://127.0.0.1:9931",
            }),
          ],
          "http://127.0.0.1:8081": [
            createMockModel("model-2", {
              serverUrl: "http://127.0.0.1:8081",
            }),
          ],
        },
        {
          "http://127.0.0.1:9931": disconnectKept,
          "http://127.0.0.1:8081": disconnectRemoved,
        },
      );

      const manager = await createManager(
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      );
      expect(manager.servers).toHaveLength(2);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).toHaveBeenCalledTimes(1);
      expect(mockPi.unregisterProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
      );
      expect(disconnectRemoved).toHaveBeenCalledTimes(1);
      // Surviving providers keep their SSE manager connected (today's behavior)
      expect(disconnectKept).not.toHaveBeenCalled();
      expect((await manager.getAllModels()).map((m) => m.id)).toEqual([
        "model-1",
      ]);
    });

    it("should unregister the old provider when a server URL changes", async () => {
      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
        ],
        "http://127.0.0.1:9090": [
          createMockModel("model-1", { serverUrl: "http://127.0.0.1:9090" }),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9090"),
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:9931",
      );
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:9090",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:9090/v1" }),
      );
      expect(manager.servers[0]?.providerId).toBe(
        "llama-server=http://127.0.0.1:9090",
      );
    });

    it("should re-register same-id servers without unregistering (name edit)", async () => {
      const manager = await createManager(
        configOf("http://127.0.0.1:9931", {
          customId: "my-custom-id",
          customName: "A",
        }),
      );

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931", {
          customId: "my-custom-id",
          customName: "B",
        }),
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).not.toHaveBeenCalled();
      expect(vi.mocked(mockPi.registerProvider).mock.calls.at(-1)).toEqual([
        "my-custom-id",
        expect.objectContaining({ name: "Llama.cpp (B)" }),
      ]);
      expect(manager.servers[0]?.providerId).toBe("my-custom-id");
    });

    it("should collapse duplicate URLs into a single server", async () => {
      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
        ],
      });
      const manager = await createManager(
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:9931"),
      );

      expect(manager.servers).toHaveLength(1);
      expect(mockPi.registerProvider).toHaveBeenCalledTimes(1);
      expect(await manager.getAllModels()).toHaveLength(1);
    });

    it("should return undefined from getServer for a removed server's model", async () => {
      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const live = (await manager.getAllModels())[0];
      expect(manager.getServer(live)).toBe(manager.servers[0]);

      const orphan = { serverUrl: "http://gone:1" } as unknown as BaseModel;
      expect(manager.getServer(orphan)).toBeUndefined();
    });
  });

  describe("sortBy", () => {
    const sortBy = () => vi.mocked(settingsStub.resolveSortBy);

    it("should return models in API order when sortBy is 'api'", async () => {
      sortBy().mockResolvedValue("api");

      const mockModelA = createMockModel("model-a");
      const mockModelZ = createMockModel("model-z");
      seedServers({
        "http://127.0.0.1:9931": [mockModelA, mockModelZ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-z");
    });

    it("should sort models by ID ascending when sortBy is 'asc'", async () => {
      sortBy().mockResolvedValue("asc");

      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-z"),
          createMockModel("model-a"),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-z");
    });

    it("should sort models by ID descending when sortBy is 'desc'", async () => {
      sortBy().mockResolvedValue("desc");

      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("model-a"),
          createMockModel("model-z"),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-z");
      expect(allModels[1]?.id).toBe("model-a");
    });

    it("should sort models by name ascending when sortBy is 'asc-name'", async () => {
      sortBy().mockResolvedValue("asc-name");

      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("zebra", { id: "model-b" }),
          createMockModel("alpha", { id: "model-a" }),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-b");
    });

    it("should sort models by name descending when sortBy is 'desc-name'", async () => {
      sortBy().mockResolvedValue("desc-name");

      seedServers({
        "http://127.0.0.1:9931": [
          createMockModel("alpha", { id: "model-a" }),
          createMockModel("zebra", { id: "model-b" }),
        ],
      });
      const manager = await createManager(configOf("http://127.0.0.1:9931"));

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-b");
      expect(allModels[1]?.id).toBe("model-a");
    });
  });
});
