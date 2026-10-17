import type { SSEClient } from "../../src/sse/client";
import { describe, expect, it, vi } from "vitest";
import { SSEManager } from "../../src/sse/manager";
import { createMockServer } from "../mocks/server";
import { mockResolver } from "../mocks/server";
import { createMockSSEClient, dispatchToMockClient } from "../mocks/sseClient";
import { makeResolverStub } from "../mocks/settings";

/**
 * Builds an SSEManager bound to a stub server, mirroring how
 * `Server.initialize()` wires it up (timeouts come from the resolver).
 * Optionally injects an SSEClient and a custom fetch implementation.
 */
const createManager = (
  pollingTimeout = 60000,
  serverTimeout = 1000,
  sseClient?: SSEClient,
  fetchFn?: typeof globalThis.fetch,
): SSEManager =>
  new SSEManager(
    createMockServer({
      resolver: mockResolver,
      options: { baseUrl: "http://127.0.0.1:9931" },
    }),
    makeResolverStub({
      resolvePollingTimeout: vi.fn(async () => pollingTimeout),
      resolveServerTimeout: vi.fn(async () => serverTimeout),
    }),
    sseClient,
    fetchFn,
  );

describe("SSEManager subscribeToStatus", () => {
  it("should reject after the server's pollingTimeout, not the constant", async () => {
    vi.useFakeTimers();
    // Never-resolving fetch: the connection stays open but no events arrive
    const fetchMock = vi.fn(
      async () => new Promise<Response>(() => {}),
    ) as typeof globalThis.fetch;

    const manager = createManager(5000, 1000, undefined, fetchMock);
    const promise = manager.subscribeToStatus("test-model");
    const expectation = expect(promise).rejects.toThrow(
      "SSE status timeout for model: test-model",
    );

    // If the timer still used the fixed 60 s constant, advancing 5 s
    // would not trigger the rejection.
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;

    vi.useRealTimers();
  });

  it("should resolve when a terminal status arrives before the timeout", async () => {
    vi.useFakeTimers();
    // Inject a mock SSEClient so the test can emit events manually
    const mockClient = createMockSSEClient();

    try {
      const manager = createManager(5000, 1000, mockClient);
      const promise = manager.subscribeToStatus("test-model");
      const expectation = expect(promise).resolves.toMatchObject({
        status: "loaded",
      });

      manager.subscribeToProgress("test-model", () => {});
      await vi.advanceTimersByTimeAsync(0);

      // Emit a terminal status through the injected client
      dispatchToMockClient(mockClient, {
        event: "status_change",
        model: "test-model",
        data: { status: "loaded" },
      });

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
