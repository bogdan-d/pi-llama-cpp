import { beforeEach, describe, expect, it } from "vitest";
import { StatsManager } from "../src/managers/stats";

/**
 * Drives a StatsManager's SSE parser by feeding raw `data: {...}` lines through
 * its stream interceptor, the same path a real llama.cpp response takes.
 */
async function feedSse(
  manager: StatsManager,
  lines: string[],
): Promise<void> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(line));
      }
      controller.close();
    },
  });

  // captureTimings is private; reach it through the test seam.
  const out = (manager as unknown as {
    captureTimings: (b: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
  }).captureTimings(input);

  const reader = out.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/** Build a manager with a UI that records working-message and widget updates. */
function createManager(): {
  manager: StatsManager;
  messages: (string | undefined)[];
  widgetSets: { key: string; content: string[] | undefined }[];
} {
  const manager = new StatsManager(["http://127.0.0.1:8080"]);
  const messages: (string | undefined)[] = [];
  const widgetSets: { key: string; content: string[] | undefined }[] = [];
  const seam = manager as unknown as {
    uiRef: {
      setWorkingMessage: (m?: string) => void;
      setWidget: (key: string, content: string[] | undefined) => void;
    };
    hasUIRef: boolean;
  };
  seam.uiRef = {
    setWorkingMessage: (m?: string) => messages.push(m),
    setWidget: (key, content) => widgetSets.push({ key, content }),
  };
  seam.hasUIRef = true;
  return { manager, messages, widgetSets };
}

const data = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n`;

beforeEach(() => {
  // Throttle uses Date.now(); nothing global is mutated by StatsManager here.
});

describe("StatsManager display lifecycle", () => {
  it("shows prefill progress, then generation, then final stats", async () => {
    const { manager, messages } = createManager();

    await feedSse(manager, [
      data({ prompt_progress: { processed: 1, total: 2, time_ms: 10 } }),
      data({ prompt_progress: { processed: 2, total: 2, time_ms: 20 } }),
      data({
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      }),
      data({
        choices: [
          { index: 0, delta: { content: " world" }, finish_reason: "stop" },
        ],
      }),
      data({
        choices: [],
        timings: {
          predicted_n: 2,
          predicted_ms: 1000,
          predicted_per_second: 98.3,
        },
        usage: { completion_tokens: 2, completion_time_ms: 1000 },
      }),
      "data: [DONE]\n",
    ]);

    // Prefill bar was shown.
    expect(messages.some((m) => m?.startsWith("Prefilling..."))).toBe(true);
    // Generation phase was reached (bridged from prefill completion).
    expect(messages.some((m) => m?.startsWith("Generating..."))).toBe(true);
    // Final summary uses the server's authoritative timings.
    expect(messages.at(-1)).toBe("Done! 2 tok · 98.3 tok/s · 1s");
  });

  it("shows token-generation stats even without prefill events", async () => {
    // Regression: TG was previously gated behind `hasReceivedPrefill`, so a
    // request that emits no prompt_progress never displayed generation stats.
    const { manager, messages } = createManager();

    await feedSse(manager, [
      data({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
      }),
      data({
        choices: [
          { index: 0, delta: { content: " there" }, finish_reason: "stop" },
        ],
      }),
      data({
        choices: [],
        usage: { completion_tokens: 2, completion_time_ms: 200 },
      }),
      "data: [DONE]\n",
    ]);

    // Never entered prefilling.
    expect(messages.every((m) => !m?.startsWith("Prefilling..."))).toBe(true);
    // Generation stats were shown live.
    expect(messages.some((m) => m?.startsWith("Generating..."))).toBe(true);
    // Final summary derived from usage when timings are absent (2 tok / 0.2s = 10 tok/s).
    expect(messages.at(-1)).toBe("Done! 2 tok · 10.0 tok/s · 0s");
  });

  it("does not emit any working message while idle", async () => {
    const { manager, messages } = createManager();

    // A chunk that is neither prefill, content, nor final should be a no-op.
    await feedSse(manager, [data({ object: "chat.completion.chunk" })]);

    expect(messages).toHaveLength(0);
  });
});

describe("StatsManager message formatters", () => {
  it("formats live generation stats from the sliding token window", () => {
    const { manager } = createManager();
    const seam = manager as unknown as {
      tg: { count: number; genStartMs: number };
      tokenTimes: number[];
      formatGenMessage: () => string;
    };
    // 9 tokens spread evenly over the last second → ~10 tok/s (cumulative
    // average would instead decay if the window included idle time).
    const now = Date.now();
    seam.tokenTimes = Array.from({ length: 9 }, (_, i) => now - 800 + i * 100);
    seam.tg = { count: 9, genStartMs: now - 1000 };

    expect(seam.formatGenMessage()).toBe("Generating... 9 tok · 10.0 tok/s · 1s");
  });

  it("window rate ignores idle time, so long generations don't decay to 0", () => {
    // Regression for the reported bug: cumulative `count / elapsed-since-start`
    // decayed toward 0 whenever the SSE stream burst or paused. The sliding
    // window must report the true rate regardless of how long ago we started.
    const { manager } = createManager();
    const seam = manager as unknown as {
      tg: { count: number; genStartMs: number };
      tokenTimes: number[];
      formatGenMessage: () => string;
    };
    const now = Date.now();
    // 40 tokens streamed over the last second...
    seam.tokenTimes = Array.from(
      { length: 40 },
      (_, i) => now - 975 + i * 25,
    );
    // ...but generation nominally started 60s ago (lots of elapsed idle time).
    seam.tg = { count: 40, genStartMs: now - 60_000 };

    const msg = seam.formatGenMessage();
    // Cumulative average would be 40/60 ≈ 0.7 tok/s; the window reports ~40.
    expect(msg).toContain("40 tok");
    expect(msg).toMatch(/\b(3[5-9]|4[0-5])\.0 tok\/s\b/);
  });

  it("formats final stats from usage when timings lack predicted_*", () => {
    const { manager } = createManager();
    const seam = manager as unknown as {
      finalStats: { prompt: unknown; generation: { n: number; ms: number } };
      formatDoneMessage: () => string;
    };
    seam.finalStats = { prompt: null, generation: { n: 20, ms: 500 } };

    // 20 tokens / 0.5s = 40 tok/s
    expect(seam.formatDoneMessage()).toBe("Done! 20 tok · 40.0 tok/s · 1s");
  });

  it("prefers authoritative predicted_per_second for the final line", () => {
    const { manager } = createManager();
    const seam = manager as unknown as {
      finalStats: {
        prompt: unknown;
        generation: { n: number; ms: number; perSec?: number };
      };
      formatDoneMessage: () => string;
    };
    seam.finalStats = {
      prompt: null,
      generation: { n: 42, ms: 1000, perSec: 98.3 },
    };

    expect(seam.formatDoneMessage()).toBe("Done! 42 tok · 98.3 tok/s · 1s");
  });
});

describe("StatsManager final-stats widget", () => {
  it("shows a two-line stats widget above the editor when done", async () => {
    const { manager, messages, widgetSets } = createManager();

    await feedSse(manager, [
      data({ prompt_progress: { processed: 1, total: 1, time_ms: 5 } }),
      data({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
      }),
      data({
        choices: [],
        timings: {
          prompt_n: 1000,
          prompt_ms: 500,
          prompt_per_second: 2000,
          predicted_n: 2,
          predicted_ms: 1000,
          predicted_per_second: 98.3,
        },
        usage: {
          prompt_tokens: 1000,
          prompt_time_ms: 500,
          completion_tokens: 2,
          completion_time_ms: 1000,
        },
      }),
      "data: [DONE]\n",
    ]);

    // Working message reached the done summary.
    expect(messages.at(-1)).toBe("Done! 2 tok · 98.3 tok/s · 1s");
    // Widget shows both phases, aligned (no cache here).
    expect(widgetSets.at(-1)).toEqual({
      key: "llama-cpp-stats",
      content: [
        "Prefill   1000 tok · 2000.0 tok/s · 1s",
        "Generate  2 tok · 98.3 tok/s · 1s",
      ],
    });
  });

  it("annotates cached prompt tokens on the prefill line", async () => {
    // Matches the cache-hit shape from llama.cpp: most of the prompt served
    // from the prompt cache, so prompt_n is only the freshly-evaluated tokens.
    const { manager, widgetSets } = createManager();
    await feedSse(manager, [
      data({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
      }),
      data({
        choices: [],
        timings: {
          cache_n: 4621,
          prompt_n: 4,
          prompt_ms: 35,
          prompt_per_second: 113.7,
          predicted_n: 108,
          predicted_ms: 2116,
          predicted_per_second: 51.0,
        },
        usage: {
          prompt_tokens: 4625,
          prompt_tokens_details: { cached_tokens: 4621 },
          completion_tokens: 108,
          completion_time_ms: 2116,
        },
      }),
      "data: [DONE]\n",
    ]);

    expect(widgetSets.at(-1)).toEqual({
      key: "llama-cpp-stats",
      content: [
        "Prefill   4 tok · 113.7 tok/s · 0s · 4621 cached",
        "Generate  108 tok · 51.0 tok/s · 2s",
      ],
    });
  });

  it("clears the widget when a new stream starts (next agent round)", async () => {
    // Agent models issue several /chat/completions per prompt (tool-call
    // rounds). A finished round's widget must be cleared when the next round
    // begins, so stale stats aren't shown while the model streams again.
    const { manager, widgetSets } = createManager();
    await feedSse(manager, [
      data({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
      }),
      data({ choices: [], usage: { completion_tokens: 1, completion_time_ms: 10 } }),
      "data: [DONE]\n",
    ]);
    expect(widgetSets.some((w) => Array.isArray(w.content))).toBe(true);

    // Second stream begins -> resetState() clears the prior widget.
    await feedSse(manager, [
      data({ prompt_progress: { processed: 1, total: 10, time_ms: 1 } }),
    ]);
    expect(widgetSets.at(-1)).toEqual({
      key: "llama-cpp-stats",
      content: undefined,
    });
  });

  it("clearFinalWidget removes the widget", () => {
    const { manager, widgetSets } = createManager();
    (manager as unknown as { clearFinalWidget: () => void }).clearFinalWidget();

    expect(widgetSets.at(-1)).toEqual({
      key: "llama-cpp-stats",
      content: undefined,
    });
  });
});
