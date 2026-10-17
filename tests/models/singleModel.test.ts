import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataProperty } from "../../src/interfaces/endpoints/models";
import { Model } from "../../src/models/model";
import { createMockServer } from "../mocks/server";
import { createMockRpc } from "../mocks/mockRpc";

/** Per-file isolated mock RPC. */
const mockRpc = createMockRpc();
/** fetch implementation backed by mockRpc — injected into every Server. */

beforeEach(() => {
  mockRpc.mockReset();
});

const createModel = (extra: Partial<DataProperty> = {}) =>
  new Model(
    {
      id: "test-model",
      aliases: ["test-alias"],
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
      ...extra,
    },
    createMockServer({
      fetchFn: mockRpc,
      overrides: {
        getCapabilities: vi
          .fn()
          .mockResolvedValue(["text"] as ("text" | "image")[]),
        getContextSize: vi.fn().mockResolvedValue(4096),
      },
    }),
  );

describe("Model", () => {
  describe("id", () => {
    it("should return the model id", () => {
      const model = createModel({ id: "my-model" });
      expect(model.id).toBe("my-model");
    });
  });

  describe("name", () => {
    it("should return the first alias", () => {
      const model = createModel();
      expect(model.name).toBe("test-alias");
    });

    it("should fall back to id when no aliases", () => {
      const model = createModel({ aliases: undefined });
      expect(model.name).toBe("test-model");
    });
  });

  describe("reasoning", () => {
    it("should default to true", () => {
      const model = createModel();
      expect(model.reasoning).toBe(true);
    });

    it("should use override when set", () => {
      const model = createModel();
      // Override reasoning on the server
      (model as unknown as Record<string, Server>).server = {
        ...model.server,
        findOverrideForModel: () => ({ reasoning: false }),
      } as unknown as typeof model.server;
      expect(model.reasoning).toBe(false);
    });
  });

  describe("getInfo", () => {
    it("should return formatted model info", async () => {
      const model = createModel();
      const info = await model.getInfo();

      expect(info).toContain("test-model");
      expect(info).toContain("test-alias");
    });
  });
});

import type { Server } from "../../src/servers/server";
