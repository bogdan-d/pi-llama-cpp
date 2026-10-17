import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ServerOptions } from "../../src/interfaces/server";
import { ServerStatus } from "../../src/enums/serverStatus";
import { ServerManager } from "../../src/managers/server";
import { createMockModel } from "../mocks/model";
import { createMockServer } from "../mocks/server";
import { createSeededServerFactory } from "../mocks/serverFactory";
import { makeSettingsStub } from "../mocks/settings";

// Injected settings stub — the single instance passed to ServerManager and
// to every `Server` it constructs (the manager injects it as the settings
// resolver). Tests re-stub members per case instead of module-mocking the
// singleton.
const settingsStub = makeSettingsStub();

const mockPi: ExtensionAPI = {
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
  registerCommand: vi.fn(),
  setModel: vi.fn(),
} as Partial<ExtensionAPI> as ExtensionAPI;

/** ServerOptions for a baseUrl — the shape `resolveServerConfigs` yields. */
const configOf = (
  baseUrl: string,
  extra: Partial<ServerOptions> = {},
): ServerOptions => ({ baseUrl, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServerManager", () => {
  it("should register providers for all servers", async () => {
    const mockModel = createMockModel("test-model", {
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    });
    vi.mocked(settingsStub.resolveApiKey).mockImplementation((id) =>
      id.includes("9931") ? "key-1" : "key-2",
    );
    const manager = new ServerManager(
      settingsStub,
      createSeededServerFactory({
        "http://127.0.0.1:9931": [mockModel],
        "http://127.0.0.1:8081": [mockModel],
      }),
    );
    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      configOf("http://127.0.0.1:9931"),
      configOf("http://127.0.0.1:8081"),
    ]);
    await manager.update(mockPi);

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
    const manager = new ServerManager(
      settingsStub,
      createSeededServerFactory({
        "http://127.0.0.1:9931": [createMockModel("model-1")],
        "http://127.0.0.1:8081": [createMockModel("model-2")],
      }),
    );
    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      configOf("http://127.0.0.1:9931"),
      configOf("http://127.0.0.1:8081"),
    ]);
    await manager.update(mockPi);

    const allModels = await manager.getAllModels();

    expect(allModels).toHaveLength(2);
    expect(allModels.map((m) => m.id)).toEqual(["model-1", "model-2"]);
  });

  describe("live server list (re-derived from settings)", () => {
    it("should register servers added after the first scan", async () => {
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
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
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);
      expect(manager.servers).toHaveLength(1);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      ]);
      await manager.update(mockPi);

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
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory(
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
        ),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      ]);
      await manager.update(mockPi);
      expect(manager.servers).toHaveLength(2);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

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
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
          ],
          "http://127.0.0.1:9090": [
            createMockModel("model-1", { serverUrl: "http://127.0.0.1:9090" }),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9090"),
      ]);
      await manager.update(mockPi);

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
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({}),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931", {
          customId: "my-custom-id",
          customName: "A",
        }),
      ]);
      await manager.update(mockPi);

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931", {
          customId: "my-custom-id",
          customName: "B",
        }),
      ]);
      await manager.update(mockPi);

      expect(mockPi.unregisterProvider).not.toHaveBeenCalled();
      expect(vi.mocked(mockPi.registerProvider).mock.calls.at(-1)).toEqual([
        "my-custom-id",
        expect.objectContaining({ name: "Llama.cpp (B)" }),
      ]);
      expect(manager.servers[0]?.providerId).toBe("my-custom-id");
    });

    it("should collapse duplicate URLs into a single server", async () => {
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      expect(manager.servers).toHaveLength(1);
      expect(mockPi.registerProvider).toHaveBeenCalledTimes(1);
      expect(await manager.getAllModels()).toHaveLength(1);
    });

    it("should return undefined from getServer for a removed server's model", async () => {
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("model-1", { serverUrl: "http://127.0.0.1:9931" }),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const live = (await manager.getAllModels())[0];
      expect(manager.getServer(live)).toBe(manager.servers[0]);

      const orphan = createMockModel("orphan", { serverUrl: "http://gone:1" });
      expect(manager.getServer(orphan)).toBeUndefined();
    });
  });

  describe("timeout → skip → retry via /models", () => {
    it("should skip a TIMEOUT server on init, then register it on /models", async () => {
      // Create real servers we can spy on
      const server1 = createMockServer({
        options: { baseUrl: "http://127.0.0.1:9931" },
      });
      const server2 = createMockServer({
        options: { baseUrl: "http://127.0.0.1:8081" },
      });

      // Server1 will timeout during health check
      vi.spyOn(server1, "isReady").mockResolvedValue(ServerStatus.TIMEOUT);
      vi.spyOn(server2, "isReady").mockResolvedValue(ServerStatus.READY);

      const manager = new ServerManager(settingsStub, {
        create: (_resolver, options) => {
          return options.baseUrl === "http://127.0.0.1:9931"
            ? server1
            : server2;
        },
      });

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      ]);

      // Phase 1: initialize with timeout → server1 is skipped
      await manager.update(mockPi, 100);

      expect(mockPi.registerProvider).toHaveBeenCalledTimes(1);
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:8081/v1" }),
      );
      expect(manager.failedUrls).toContain("http://127.0.0.1:9931");
      expect(manager.getWarnings()).toHaveLength(1);

      // Phase 2: /models without timeout → both register
      vi.mocked(mockPi.registerProvider).mockClear();

      await manager.update(mockPi);

      expect(mockPi.registerProvider).toHaveBeenCalledTimes(2);
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:9931",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:9931/v1" }),
      );
    });

    it("should skip an UNREACHABLE server on init, then register it on /models", async () => {
      const server1 = createMockServer({
        options: { baseUrl: "http://127.0.0.1:9931" },
      });
      const server2 = createMockServer({
        options: { baseUrl: "http://127.0.0.1:8081" },
      });

      // Server1 returns UNREACHABLE (non-200, non-timeout)
      vi.spyOn(server1, "isReady").mockResolvedValue(ServerStatus.UNREACHABLE);
      vi.spyOn(server2, "isReady").mockResolvedValue(ServerStatus.READY);

      const manager = new ServerManager(settingsStub, {
        create: (_resolver, options) => {
          return options.baseUrl === "http://127.0.0.1:9931"
            ? server1
            : server2;
        },
      });

      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
        configOf("http://127.0.0.1:8081"),
      ]);

      // Phase 1: with timeout → server1 is UNREACHABLE, skipped
      await manager.update(mockPi, 100);

      expect(mockPi.registerProvider).toHaveBeenCalledTimes(1);
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:8081/v1" }),
      );
      expect(manager.failedUrls).toContain("http://127.0.0.1:9931");
      expect(manager.getWarnings()).toHaveLength(1);

      // Phase 2: /models without timeout → both register
      vi.mocked(mockPi.registerProvider).mockClear();

      await manager.update(mockPi);

      expect(mockPi.registerProvider).toHaveBeenCalledTimes(2);
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:9931",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:9931/v1" }),
      );
    });
  });

  describe("registerProvider error handling", () => {
    it("should add the URL to failedUrls when initialize throws a non-auth error", async () => {
      const server = createMockServer({
        options: { baseUrl: "http://127.0.0.1:9931" },
      });
      // Simulate a non-auth error during initialization
      vi.spyOn(server, "initialize").mockRejectedValue(
        new Error("Network error"),
      );

      const manager = new ServerManager(settingsStub, {
        create: () => server,
      });
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);

      await manager.update(mockPi);

      expect(mockPi.registerProvider).not.toHaveBeenCalled();
      expect(manager.failedUrls).toContain("http://127.0.0.1:9931");
    });
  });

  describe("sortBy", () => {
    const sortBy = () => vi.mocked(settingsStub.resolveSortBy);

    it("should return models in API order when sortBy is 'api'", async () => {
      sortBy().mockResolvedValue("api");

      const mockModelA = createMockModel("model-a");
      const mockModelZ = createMockModel("model-z");
      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [mockModelA, mockModelZ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-z");
    });

    it("should sort models by ID ascending when sortBy is 'asc'", async () => {
      sortBy().mockResolvedValue("asc");

      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("model-z"),
            createMockModel("model-a"),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-z");
    });

    it("should sort models by ID descending when sortBy is 'desc'", async () => {
      sortBy().mockResolvedValue("desc");

      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("model-a"),
            createMockModel("model-z"),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-z");
      expect(allModels[1]?.id).toBe("model-a");
    });

    it("should sort models by name ascending when sortBy is 'asc-name'", async () => {
      sortBy().mockResolvedValue("asc-name");

      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("zebra", { id: "model-b" }),
            createMockModel("alpha", { id: "model-a" }),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-a");
      expect(allModels[1]?.id).toBe("model-b");
    });

    it("should sort models by name descending when sortBy is 'desc-name'", async () => {
      sortBy().mockResolvedValue("desc-name");

      const manager = new ServerManager(
        settingsStub,
        createSeededServerFactory({
          "http://127.0.0.1:9931": [
            createMockModel("alpha", { id: "model-a" }),
            createMockModel("zebra", { id: "model-b" }),
          ],
        }),
      );
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        configOf("http://127.0.0.1:9931"),
      ]);
      await manager.update(mockPi);

      const allModels = await manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]?.id).toBe("model-b");
      expect(allModels[1]?.id).toBe("model-a");
    });
  });
});
