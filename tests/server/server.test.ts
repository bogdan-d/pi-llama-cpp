import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mode } from "../../src/enums/mode";
import { ServerStatus } from "../../src/enums/serverStatus";
import type { PropsEndpoint } from "../../src/interfaces/endpoints/props";
import type { SettingsService } from "../../src/settings/settings";
import { Server } from "../../src/server";
import { createMockServer } from "../mocks/server";
import { mockResolver, mockServerOptions } from "../mocks/server";
import { installFetchStub, mockRpc } from "../mocks/rpc";
import { makeResolverStub, makeSettingsStub } from "../mocks/settings";

// Injected into every real Server below; fresh per test so per-case
// overrides never leak. The Server constructor resolves the API key eagerly
// (ApiClient built there) — the stub's placeholder key is never consumed.
let settings: SettingsService;

beforeEach(() => {
  mockRpc.mockClear();
  installFetchStub();
  settings = makeSettingsStub();
});

describe("Server providerId", () => {
  it("should generate a unique provider ID from baseUrl", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:9931" });
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:9931");
  });

  it("should generate different IDs for different baseUrls", () => {
    const server1 = new Server(settings, { baseUrl: "http://127.0.0.1:9931" });
    const server2 = new Server(settings, { baseUrl: "http://127.0.0.1:8081" });
    expect(server1.providerId).not.toBe(server2.providerId);
  });
});

describe("Server providerName", () => {
  it("should generate a human-readable provider name", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:9931" });
    expect(server.providerName).toBe("Llama.cpp (http://127.0.0.1:9931)");
  });
});

describe("Server apiBaseUrl", () => {
  it("should append the ENDPOINT_PREFIX to baseUrl", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:9931" });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:9931/v1");
  });

  it("should not double the prefix when baseUrl already ends with it", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:9931/v1",
    });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:9931/v1");
  });

  it("should keep baseUrl untouched for provider identity", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:9931" });
    expect(server.baseUrl).toBe("http://127.0.0.1:9931");
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:9931");
  });
});

describe("Server fetchModels", () => {
  it("should call the /models endpoint", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });

    const server = createMockServer();
    const result = await server.fetchModels();

    expect(result).toEqual({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });
    expect(mockRpc).toHaveBeenCalledWith("/v1/models");
  });
});

describe("Server fetchModelProps", () => {
  it("should call the /props endpoint with model id", async () => {
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      default_generation_settings: {},
      total_slots: 1,
      model_alias: "test",
      model_path: "/path/to/model.gguf",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
    });

    const server = createMockServer();
    const result = await server.fetchModelProps("test-model");

    expect(result.is_sleeping).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });
});

describe("Server fetchServerProps", () => {
  it("should call the /props endpoint without model", async () => {
    mockRpc.mockResolvedValueOnce({
      role: "router",
      default_generation_settings: {},
      total_slots: 2,
      model_alias: "",
      model_path: "",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
      is_sleeping: false,
    });

    const server = createMockServer();
    const result = await server.fetchServerProps();

    // Test mocks return a PropsEndpoint shape
    expect((result as PropsEndpoint).role).toBe("router");
    expect(mockRpc).toHaveBeenCalledWith("/props?autoload=false");
  });

  it("should return LlamaSwapPropsError shape for llama-swap", async () => {
    mockRpc.mockResolvedValueOnce({
      src: "llama-swap",
      error: {
        message: "no model id could be identified",
        type: "invalid_request_error",
        param: null,
        code: "not_found",
      },
    });

    const server = createMockServer();
    const result = await server.fetchServerProps();

    expect((result as { src: string }).src).toBe("llama-swap");
    expect(mockRpc).toHaveBeenCalledWith("/props?autoload=false");
  });
});

describe("Server mode detection (via initialize)", () => {
  it("should detect LLAMASWAP mode when /props returns src", async () => {
    // initialize() calls fetchModels() first, then fetchServerProps()
    mockRpc
      .mockResolvedValueOnce({
        data: [{ id: "test-model" }],
        object: "list",
      })
      .mockResolvedValueOnce({
        src: "llama-swap",
        error: {
          message: "no model id could be identified",
          type: "invalid_request_error",
          param: null,
          code: "not_found",
        },
      });

    const server = createMockServer(
      mockResolver,
      mockServerOptions,
      undefined,
      {
        initialize: async () => {
          await Server.prototype.initialize.call(server);
        },
      },
    );
    await server.initialize();

    expect(server.models[0].mode).toBe(Mode.LLAMASWAP);
  });
});

describe("Server postRequest", () => {
  it("should call /models/load with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("load", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/load", {
      model: "test-model",
    });
  });

  it("should call /models/unload with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("unload", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/unload", {
      model: "test-model",
    });
  });
});

describe("Server isReady", () => {
  // `isReady` probes through the server's ApiClient — stub raw `fetch` per test.
  const stubFetch = (impl: (url: string) => Promise<unknown>) => {
    vi.stubGlobal("fetch", vi.fn(impl));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return READY when health and auth succeed", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.READY);
  });

  it("should return UNAUTHORIZED when auth fails", async () => {
    stubFetch(async (url: string) =>
      url.includes("/health")
        ? { ok: true, status: 200, json: async () => ({}) }
        : { ok: false, status: 401, json: async () => ({}) },
    );

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNAUTHORIZED);
  });

  it("should return UNREACHABLE when health check fails", async () => {
    stubFetch(async () => {
      throw new Error("connection refused");
    });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE when health status is not ok", async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return TIMEOUT when the health check aborts", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.TIMEOUT);
  });

  it("should perform exactly one /v1/models call across isReady + initialize", async () => {
    // Regression: the auth probe warms the ApiClient cache, so the models
    // fetch during `initialize()` must be served from cache, not the network.
    installFetchStub();
    mockRpc.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/v1/models") return { data: [{ id: "m1" }] };
      return {}; // /health → 200, /props → SINGLE mode
    });

    const server = new Server(makeResolverStub(), {
      baseUrl: "http://127.0.0.1:9931",
    });
    await server.isReady(1000);
    await server.initialize();

    const fetchMock = vi.mocked(globalThis.fetch);
    const modelsCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/models"),
    ).length;
    expect(modelsCalls).toBe(1);
  });
});
