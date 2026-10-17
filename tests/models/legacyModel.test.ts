import { beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { Mode } from "../../src/enums/mode";
import { DataProperty } from "../../src/interfaces/endpoints/models";
import { LegacyModel } from "../../src/models/legacyModel";
import { createMockServer } from "../mocks/server";
import { createRpcFetch } from "../mocks/rpc";
import { createMockRpc } from "../mocks/mockRpc";

/** Per-file isolated mock RPC. */
const mockRpc = createMockRpc();
/** fetch implementation backed by mockRpc — injected into every Server. */
const mockFetch = createRpcFetch(mockRpc);

/**
 * Servers wired to this file's mock RPC through their `ApiClient` —
 * no global `fetch` stubbing.
 */
const createRpcServer = (opts = {}) =>
  createMockServer({ ...opts, fetchFn: mockFetch });

import { makeResolverStub } from "../mocks/settings";

beforeEach(() => {
  mockRpc.mockReset();
});

const createModel = (extra: Partial<DataProperty> = {}): LegacyModel =>
  new LegacyModel(
    {
      id: "test",
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
      ...extra,
    },
    createRpcServer({}),
    makeResolverStub(),
  );

describe("LegacyModel mode", () => {
  it("should always return LEGACY mode", () => {
    const model = createModel();
    expect(model.mode).toBe(Mode.LEGACY);
  });
});

describe("LegacyModel capabilities (via toProviderConfig)", () => {
  it("should detect image capability when multimodal is in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });
    mockRpc.mockResolvedValue({ n_ctx: 4096, data: [{ max_model_len: 8192 }] });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text", "image"]);
  });

  it("should detect text-only capability when multimodal is not in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: false } });
    mockRpc.mockResolvedValue({ n_ctx: 4096, data: [{ max_model_len: 8192 }] });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });

  it("should fall back to text-only when auth fails", async () => {
    mockRpc.mockRejectedValueOnce(new Error("401 Unauthorized")); // /props
    mockRpc.mockRejectedValueOnce(new Error("401 Unauthorized")); // /v1/models in BaseModel's catch
    mockRpc.mockResolvedValue({
      n_ctx: 4096,
      data: [{ max_model_len: 8192 }],
      models: [{ capabilities: ["text"] }],
    });

    const model = createModel();
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
  });
});

describe("LegacyModel context size (via toProviderConfig)", () => {
  // Capabilities and context size both read /props within one poll tick, so
  // the ApiClient cache serves them the same response — it must carry every
  // field both readers need.
  it("should use max_model_len when it is non-zero", async () => {
    mockRpc.mockResolvedValueOnce({
      modalities: { vision: false },
      n_ctx: 4096,
    }); // /props (cached for capabilities + context size)
    mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: 8192 }] }); // /v1/models

    const model = createModel();
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(8192);
    expect(mockRpc).toHaveBeenCalledWith("/v1/models");
  });

  it("should fall back to n_ctx when max_model_len is 0", async () => {
    mockRpc.mockResolvedValueOnce({
      modalities: { vision: false },
      n_ctx: 4096,
    }); // /props (cached for capabilities + context size)
    mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: 0 }] }); // /v1/models

    const model = createModel();
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(4096);
  });

  it("should return FALLBACK_CTX when both values are missing/null", async () => {
    mockRpc.mockResolvedValueOnce({
      modalities: { vision: false },
    }); // /props (cached for capabilities + context size)
    mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: null }] }); // /v1/models

    const model = createModel();
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(FALLBACK_CTX);
  });
});
