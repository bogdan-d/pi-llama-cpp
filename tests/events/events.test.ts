import { beforeEach, describe, expect, it, vi } from "vitest";
import { THINKING_BUDGETS } from "../../src/constants";
import { Status } from "../../src/enums/status";
import { EventManager } from "../../src/managers/events";
import { BaseModel } from "../../src/models/baseModel";
import { ServerManager } from "../../src/managers/server";
import type { Server } from "../../src/server";
import { createMockModel } from "../mocks/model";
import { createMockPi } from "../mocks/context";
import { createMockServer } from "../mocks/server";
import { makeSettingsStub } from "../mocks/settings";
import { stubInitialize } from "../mocks/server";

/**
 * Injected settings stub (EventManager and — in the live-list test — the
 * real ServerManager). Recreated in `beforeEach` so per-case overrides
 * (budgets, autoload, …) cannot leak between tests.
 */
let settingsStub = makeSettingsStub();
let mockPi = createMockPi();

/**
 * Builds an EventManager on a ServerManager stub exposing `servers` and
 * `getServer`. (The real ServerManager is exercised in the live-list test
 * below.)
 */
const createEventManager = (...servers: Server[]) =>
  new EventManager(
    {
      servers,
      getServer: (model: BaseModel) =>
        servers.find((s) => s.models.some((m) => m.id === model.id)),
      update: vi.fn(async () => {}),
    } as unknown as ServerManager,
    settingsStub,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  EventManager.resetInflightModel();
  settingsStub = makeSettingsStub();
  mockPi = createMockPi();
});

const createPayload = (modelId: string) => ({
  model: modelId,
  messages: [{ role: "user", content: "hello" }],
});

const createNonLlamaPayload = () => ({
  model: "gpt-4",
  messages: [{ role: "user", content: "hello" }],
});

const createMockCtx = (
  thinkingLevel?:
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max",
) =>
  ({
    thinkingLevel,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  }) as any;

describe("EventManager.onBeforeProviderRequest", () => {
  describe("normal usage — each thinking level", () => {
    it.each([
      {
        level: "off",
        expected: { chat_template_kwargs: { enable_thinking: false } },
      },
      { level: "minimal", expected: { thinking_budget_tokens: 1024 } },
      { level: "low", expected: { thinking_budget_tokens: 2048 } },
      { level: "medium", expected: { thinking_budget_tokens: 8192 } },
      { level: "high", expected: { thinking_budget_tokens: 16384 } },
      { level: "xhigh", expected: { thinking_budget_tokens: 32768 } },
      { level: "max", expected: {} },
    ])(
      'level "$level" should return $expected',
      async ({ level, expected }) => {
        vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue(
          level as any,
        );

        const server = createMockServer({
          models: ["model-a"].map((id) => createMockModel(id)),
        });
        const eventManager = createEventManager(server);
        const event = { payload: createPayload("model-a") };

        const ctx = createMockCtx(level as any);
        const result = (await eventManager.onBeforeProviderRequest(
          event as any,
          ctx,
          mockPi as any,
        )) as Record<string, unknown>;

        expect(result.model).toBe("model-a");
        expect(result).toMatchObject(expected);
      },
    );

    it("should preserve original payload fields alongside new ones", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("low");

      const server = createMockServer({
        models: ["model-b"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = {
        payload: {
          model: "model-b",
          messages: [{ role: "user", content: "test" }],
          temperature: 0.7,
        },
      };

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      expect(result.messages).toEqual([{ role: "user", content: "test" }]);
      expect(result.temperature).toBe(0.7);
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.low);
    });
  });

  describe("non-llama.cpp models", () => {
    it("should return the payload unchanged for unknown models", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createNonLlamaPayload() };

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      );

      expect(result).toEqual(createNonLlamaPayload());
    });
  });

  describe("missing model in payload", () => {
    it("should return the payload unchanged when model is absent", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: { messages: [] } };

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      );

      expect(result).toEqual({ messages: [] });
    });
  });

  describe("user-defined budget overrides", () => {
    it("should use user-defined budgets instead of defaults", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("low");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        low: 4096,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(4096);
    });

    it("should merge user budgets with defaults (partial override)", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("medium");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        low: 4096,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      // medium uses default since user only overrode low
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should ignore invalid keys in user budgets (they are silently dropped)", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("medium");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        foo: 999,
        bar: 123,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      // Should fall back to default since "medium" is not in user budgets
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
    });

    it("should not allow overriding 'off' — thinking stays disabled", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("off");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        off: 99999,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("off");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should not inject budget for 'max' — unlimited reasoning", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("max");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        max: 1,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("max");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      expect(result).toEqual(createPayload("model-a"));
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should handle empty user budgets gracefully", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("high");
      // No user overrides — the resolver returns the default budget table
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("high");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
        mockPi as any,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.high);
    });
  });
});

describe("EventManager.onModelSelect", () => {
  beforeEach(() => {
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(true);
  });

  it("should load the model when reactToModelSelect is true", async () => {
    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = {
      model: { provider: server.providerId, id: "model-a" },
    } as any;

    await eventManager.onModelSelect(event, ctx, mockPi as any);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });

  it("should return early when reactToModelSelect is false", async () => {
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(false);

    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = {
      model: { provider: server.providerId, id: "model-a" },
    } as any;

    await eventManager.onModelSelect(event, ctx, mockPi as any);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("EventManager.autoLoadIfNeeded", () => {
  it("should load the model when autoloadOnMessage is true and model is UNLOADED", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];
    const ctx = createMockCtx();

    await (eventManager as any).autoLoadIfNeeded(model, ctx, mockPi);

    expect(model.load).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });

  it("should not load the model when autoloadOnMessage is false", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(false);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];
    const ctx = createMockCtx();

    await (eventManager as any).autoLoadIfNeeded(model, ctx, mockPi);

    expect(model.load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is already LOADED", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.LOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];
    const ctx = createMockCtx();

    await (eventManager as any).autoLoadIfNeeded(model, ctx, mockPi);

    expect(model.load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is SLEEPING", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.SLEEPING),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];
    const ctx = createMockCtx();

    await (eventManager as any).autoLoadIfNeeded(model, ctx, mockPi);

    expect(model.load).not.toHaveBeenCalled();
  });
});

describe("EventManager with a live ServerManager", () => {
  it("should observe servers added after construction", async () => {
    // Models are seeded into manager-built Servers via the initialize stub,
    // mirroring what a real `Server.initialize()` fetch would produce.
    stubInitialize((server) =>
      server.models.push(
        ...(server.baseUrl === "http://127.0.0.1:8081"
          ? [createMockModel("model-b", { serverUrl: server.baseUrl })]
          : [createMockModel("model-a", { serverUrl: server.baseUrl })]),
      ),
    );

    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      { baseUrl: "http://127.0.0.1:9931" },
    ]);
    const serverManager = new ServerManager(settingsStub);
    const mockPi = { registerProvider: vi.fn(), unregisterProvider: vi.fn() };
    await serverManager.update(mockPi as any);

    const eventManager = new EventManager(serverManager, settingsStub);

    // Second scan adds the 8081 server — no manager re-construction
    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      { baseUrl: "http://127.0.0.1:9931" },
      { baseUrl: "http://127.0.0.1:8081" },
    ]);
    await serverManager.update(mockPi as any);

    // onBeforeProviderRequest sees the new server's models
    const ctx = createMockCtx("medium");
    const result = (await eventManager.onBeforeProviderRequest(
      { payload: createPayload("model-b") } as any,
      ctx,
      mockPi as any,
    )) as Record<string, unknown>;
    expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);

    // onModelSelect sees the new server's models too
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(true);
    const selectCtx = createMockCtx();
    await eventManager.onModelSelect(
      {
        model: {
          provider: "llama-server=http://127.0.0.1:8081",
          id: "model-b",
        },
      } as any,
      selectCtx,
      mockPi as any,
    );
    expect(selectCtx.ui.notify).toHaveBeenCalledWith(
      "Loading model-b...",
      "info",
    );
  });
});
