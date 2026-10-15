import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { Mode } from "../../src/enums/mode";
import { DataProperty } from "../../src/interfaces/endpoints/models";
import { RouterModel } from "../../src/models/routerModel";
import { createMockServer } from "../mocks/server";
import { installFetchStub, mockRpc } from "../mocks/rpc";
import { makeResolverStub } from "../mocks/settings";

// Helper to create a mock DataProperty
const createModel = (overrides: Partial<DataProperty> = {}): DataProperty => ({
  id: "test-model",
  aliases: ["test-alias"],
  tags: [],
  object: "model",
  owned_by: "test",
  created: Date.now(),
  status: { value: "loaded", args: [], preset: "default", failed: false },
  ...overrides,
});

beforeEach(() => {
  mockRpc.mockClear();
  installFetchStub();
});

describe("RouterModel context size (via toProviderConfig)", () => {
  /** Mocks for an unloaded model: capabilities detection fails (text-only),
   * then the status probe fails so context size falls back to CLI args. */
  const mockUnloaded = () => {
    mockRpc.mockRejectedValueOnce(new Error("props not available")); // capabilities: /props
    mockRpc.mockResolvedValueOnce({ data: [] }); // capabilities: /v1/models
    mockRpc.mockRejectedValueOnce(new Error("props not available")); // status: /props
  };

  it("should extract --ctx-size when unloaded", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: [
            "--model",
            "gguf",
            "--ctx-size",
            "4096",
            "--batch-size",
            "512",
          ],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(4096);
  });

  it("should fall back to --fit-ctx when --ctx-size is not present", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: ["--model", "gguf", "--fit-ctx", "8192"],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(8192);
  });

  it("should prefer --ctx-size over --fit-ctx", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: ["--model", "gguf", "--ctx-size", "4096", "--fit-ctx", "8192"],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(4096);
  });

  it("should fall back to FALLBACK_CTX when no size argument is present", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: ["--model", "gguf", "--batch-size", "512"],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(FALLBACK_CTX);
  });

  it("should fall back to FALLBACK_CTX when the argument has no following value", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: ["--model", "gguf", "--ctx-size"],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(FALLBACK_CTX);
  });

  it("should fall back to FALLBACK_CTX when the argument value is not a valid number", async () => {
    mockUnloaded();
    const model = new RouterModel(
      createModel({
        status: {
          value: "unloaded",
          args: ["--model", "gguf", "--ctx-size", "not-a-number"],
          preset: "default",
        },
      }),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(FALLBACK_CTX);
  });

  it("should return n_ctx from meta when loaded", async () => {
    // Capabilities and status both read /props within one poll tick, so the
    // ApiClient cache serves them the same response.
    mockRpc.mockResolvedValueOnce({
      modalities: { vision: false },
      is_sleeping: false,
    }); // /props (cached for capabilities + status)
    // super.getContextSize() -> fetchModels with meta.n_ctx
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          meta: { n_ctx: 4096 },
        },
      ],
    });

    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );

    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(4096);
  });
});

describe("RouterModel capabilities detection (via toProviderConfig)", () => {
  it("should detect image capability when modalities.vision is true", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });

    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text", "image"]);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });

  it("should return text-only when fetchModelProps fails", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns empty data so model is not found
    mockRpc.mockResolvedValueOnce({ data: [] });

    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });

  it("should detect text-only capability when only text in input_modalities", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns the data
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          status: {
            value: "loaded",
            args: [],
            preset: "default",
            failed: false,
          },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    });

    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });

  it("should return text when model not found in /models response", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns data without matching model
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "other-model",
          status: {
            value: "loaded",
            args: [],
            preset: "default",
            failed: false,
          },
        },
      ],
    });

    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });
});

describe("RouterModel mode", () => {
  it("should always return ROUTER mode", () => {
    const model = new RouterModel(
      createModel(),
      createMockServer(),
      makeResolverStub(),
    );
    expect(model.mode).toBe(Mode.ROUTER);
  });
});

describe("RouterModel unload", () => {
  it("should call postRequest then poll until UNLOADED", async () => {
    const mockServer = createMockServer();
    const model = new RouterModel(
      createModel(),
      mockServer,
      makeResolverStub(),
    );

    // postRequest for unload
    mockRpc.mockResolvedValueOnce({ data: [] });
    // getStatus: fetchModelProps returns UNLOADED shape
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      error: { code: 400, message: "model is not loaded" },
    });

    await model.unload();

    expect(mockRpc).toHaveBeenNthCalledWith(1, "/models/unload", {
      model: "test-model",
    });
  });

  it("should throw on timeout before reaching UNLOADED", async () => {
    const mockServer = createMockServer({
      pollingTimeout: 100,
    });
    const model = new RouterModel(
      createModel(),
      mockServer,
      makeResolverStub({ resolvePollingTimeout: vi.fn(async () => 100) }),
    );

    // postRequest
    mockRpc.mockResolvedValueOnce({ data: [] });
    // getStatus keeps returning LOADING (error.code === 503)
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      error: { code: 503 },
    });

    await expect(model.unload()).rejects.toThrow("timed out");
  });

  it("should resolve when status reaches UNLOADED", async () => {
    const mockServer = createMockServer();
    const model = new RouterModel(
      createModel(),
      mockServer,
      makeResolverStub(),
    );

    // postRequest
    mockRpc.mockResolvedValueOnce({ data: [] });
    // getStatus: first call returns LOADING, second returns UNLOADED
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      error: { code: 503 },
    });
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      error: { code: 400, message: "model is not loaded" },
    });

    await expect(model.unload()).resolves.toBeUndefined();
  });
});
