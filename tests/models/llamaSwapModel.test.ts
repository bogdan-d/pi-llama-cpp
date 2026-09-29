import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mode } from "../../src/enums/mode";
import { Status } from "../../src/enums/status";
import { LlamaSwapModel } from "../../src/models/llamaSwapModel";
import { createMockServer, mockRpc } from "../mocks";

beforeEach(() => {
  mockRpc.mockReset();
});

const createModel = (
  extra: Partial<Record<string, unknown>> = {},
  serverOverrides: Parameters<typeof createMockServer>[0] = {},
): LlamaSwapModel =>
  new LlamaSwapModel(
    {
      id: "test-model",
      aliases: ["test-alias"],
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
      ...extra,
    } as any,
    createMockServer({ baseUrl: "http://127.0.0.1:8080", ...serverOverrides }),
  );

describe("LlamaSwapModel mode", () => {
  it("should always return LLAMASWAP mode", () => {
    const model = createModel();
    expect(model.mode).toBe(Mode.LLAMASWAP);
  });
});

describe("LlamaSwapModel capabilities", () => {
  beforeEach(() => {
    mockRpc.mockReset().mockResolvedValue({
      data: [
        {
          id: "test-model",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
        },
      ],
    });
  });

  it("should detect image capability when input_modalities includes image", async () => {
    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text", "image"]);
  });

  it("should detect text-only capability when input_modalities only has text", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });

  it("should return text-only when model is not found in fetchModels response", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "other-model",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
        },
      ],
    });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });

  it("should return text-only when architecture is undefined", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
        },
      ],
    });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });
});

describe("LlamaSwapModel overrides", () => {
  it("should use contextSize override when set", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "test-model" }],
    });

    const model = createModel(
      {},
      {
        overrides: { "test-model": { contextSize: 65536 } },
      },
    );

    const { contextWindow } = await model.toProviderConfig();
    expect(contextWindow).toBe(65536);
  });

  it("should use capabilities override when set", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "test-model" }],
    });

    const model = createModel(
      {},
      {
        overrides: { "test-model": { capabilities: ["text"] } },
      },
    );

    const { input } = await model.toProviderConfig();
    expect(input).toEqual(["text"]);
  });

  it("should fall through to detection when no override matches", async () => {
    const model = createModel(
      {},
      {
        overrides: { "other-model": { contextSize: 65536 } },
      },
    );

    mockRpc
      .mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
          },
        ],
      });

    const { input } = await model.toProviderConfig();
    expect(input).toEqual(["text", "image"]);
  });
});

describe("LlamaSwapModel status", () => {
  it("should return LOADED when status.value is 'loaded'", async () => {
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
        },
      ],
    });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.LOADED);
  });

  it("should return UNLOADED when status.value is 'unloaded'", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          status: {
            value: "unloaded",
            args: [],
            preset: "default",
            failed: false,
          },
        },
      ],
    });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.UNLOADED);
  });

  it("should return UNLOADED when status.value is something other than 'loaded'", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          status: {
            value: "loading",
            args: [],
            preset: "default",
            failed: false,
          },
        },
      ],
    });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.UNLOADED);
  });

  it("should return UNLOADED when model is not found in fetchModels response", async () => {
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

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.UNLOADED);
  });

  it("should return UNLOADED when status is undefined", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
        },
      ],
    });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.UNLOADED);
  });
});

describe("LlamaSwapModel load", () => {
  it("should call GET to /upstream/{id} when model is not loaded", async () => {
    const model = createModel();
    // Override getStatus to return UNLOADED so load proceeds
    model.getStatus = vi.fn().mockResolvedValue(Status.UNLOADED);

    // mockRpc is used by ApiClient; load -> llamaSwapLoad -> apiClient.get
    mockRpc.mockResolvedValue({});

    await model.load();

    expect(mockRpc).toHaveBeenCalledWith("/upstream/test-model");
  });

  it("should throw when the GET request fails", async () => {
    const model = createModel();
    model.getStatus = vi.fn().mockResolvedValue(Status.UNLOADED);

    mockRpc.mockRejectedValue(new Error("GET failed"));

    await expect(model.load()).rejects.toThrow(
      "Model loading failed: test-model",
    );
  });

  it("should not call fetch when model is already loaded", async () => {
    const model = createModel();
    model.getStatus = vi.fn().mockResolvedValue(Status.LOADED);

    await model.load();

    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("LlamaSwapModel unload", () => {
  it("should call POST to /api/models/unload/{id}", async () => {
    const model = createModel();

    mockRpc.mockResolvedValue({});

    await model.unload();

    expect(mockRpc).toHaveBeenCalledWith("/api/models/unload/test-model");
  });
});
