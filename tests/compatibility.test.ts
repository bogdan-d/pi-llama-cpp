import type { Model } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import { describe, expect, it, vi } from "vitest";
import type { ModelOverride } from "../src/interfaces/settings";
import { EventManager } from "../src/managers/events";
import { ServerManager } from "../src/managers/server";
import { StatsManager } from "../src/managers/stats";
import {
  createMockModel,
  createMockPiContext,
  createMockServer,
  makeSettingsStub,
} from "./mocks";

// Use Pi's real serializer, but stop at onPayload before any network request.
async function captureRequest(
  override: ModelOverride,
  level: "off" | "low" = "low",
  effectiveOverride: ModelOverride = override,
) {
  const server = createMockServer({
    models: [createMockModel("model-a")],
    overrides: { "model-": override },
  });
  const settings = makeSettingsStub();
  const servers = new ServerManager(settings);
  vi.spyOn(servers, "servers", "get").mockReturnValue([server]);
  const events = new EventManager(servers, settings);
  const stats = new StatsManager(() => [server.baseUrl]);
  const model: Model<"openai-completions"> = {
    id: "model-a",
    name: "model-a",
    api: "openai-completions",
    provider: server.providerId,
    baseUrl: `${server.baseUrl}/v1`,
    reasoning: effectiveOverride.reasoning ?? true,
    input: ["text"],
    contextWindow: 8192,
    maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: effectiveOverride.compat,
  };
  const ctx = { ...createMockPiContext(vi.fn()), model, thinkingLevel: level };
  let outgoing: Record<string, unknown> | undefined;
  const response = stream(
    model,
    { messages: [] },
    {
      apiKey: "test",
      reasoningEffort: level === "off" ? undefined : level,
      onPayload: async (payload) => {
        const result = await events.onBeforeProviderRequest(
          { type: "before_provider_request", payload },
          ctx,
        );
        const init = { body: JSON.stringify(result) };
        stats["requestProgress"](init);
        outgoing = JSON.parse(init.body);
        throw new Error("request captured before network");
      },
    },
  );
  expect((await response.result()).errorMessage).toContain(
    "request captured before network",
  );
  expect(outgoing).toBeDefined();
  return outgoing;
}

describe("Pi compatibility overrides through llama.cpp request hooks", () => {
  it.each([true, false])(
    "preserves supportsUsageInStreaming=%s while requesting progress",
    async (supported) => {
      const payload = await captureRequest({
        compat: { supportsUsageInStreaming: supported },
      });
      expect(payload?.stream_options).toEqual(
        supported ? { include_usage: true } : undefined,
      );
      expect(payload?.return_progress).toBe(true);
      expect(payload?.thinking_budget_tokens).toBe(2048);
    },
  );

  it.each([
    "thinking_token_budget",
    "thinking_budget",
    "thinking_budget_tokens",
  ] as const)(
    "preserves Pi's clamped %s without injecting a competing budget",
    async (field) => {
      const payload = await captureRequest({
        compat: { thinkingTokenBudgetField: field },
      });
      // Pi reserves answer room inside maxTokens=2048. The legacy hook used
      // to replace this budget with the extension's unrelated 2048 default.
      expect(payload?.[field]).toBeGreaterThan(0);
      expect(payload?.[field]).toBeLessThan(2048);
      if (field !== "thinking_budget_tokens")
        expect(payload).not.toHaveProperty("thinking_budget_tokens");
    },
  );

  it.each(["off", "low"] as const)(
    "preserves custom chat-template kwargs with thinking %s",
    async (level) => {
      const payload = await captureRequest(
        {
          compat: {
            thinkingFormat: "chat-template",
            chatTemplateKwargs: {
              custom: "keep",
              thinking: { $var: "thinking.enabled" },
            },
          },
        },
        level,
      );
      expect(payload?.chat_template_kwargs).toEqual({
        custom: "keep",
        thinking: level !== "off",
      });
      expect(payload).not.toHaveProperty("thinking_budget_tokens");
    },
  );

  it("does not inject llama.cpp thinking controls for a non-reasoning model", async () => {
    const payload = await captureRequest({ reasoning: false }, "off");
    expect(payload).not.toHaveProperty("chat_template_kwargs");
    expect(payload).not.toHaveProperty("thinking_budget_tokens");
  });

  it("honors effective Pi model overrides outside llama settings", async () => {
    const payload = await captureRequest({}, "low", {
      compat: { thinkingTokenBudgetField: "thinking_budget" },
    });
    expect(payload?.thinking_budget).toBe(1024);
    expect(payload).not.toHaveProperty("thinking_budget_tokens");
  });
});
