import type { SSEClient } from "../../src/sse/client";
import type { SSECallback, SSEEvent } from "../../src/sse/types";
import { vi } from "vitest";

/**
 * Minimal SSEClient mock — stubs the public API and exposes a
 * `subscribers` Map so tests can grab handlers and emit events.
 */
export const createMockSSEClient = (): SSEClient => {
  const subscribers = new Map<string, SSECallback>();
  return {
    subscribers,
    subscribe: vi.fn((modelId: string, callback: SSECallback) => {
      subscribers.set(modelId, callback);
      return () => subscribers.delete(modelId);
    }),
    disconnect: vi.fn(),
    setOnConnectFailed: vi.fn(),
  } as unknown as SSEClient;
};

/**
 * Dispatches an SSE event to a model's subscriber in the mock client.
 * Returns true if a handler was found and called.
 */
export const dispatchToMockClient = (
  client: SSEClient,
  event: SSEEvent,
): boolean => {
  const handler = client.subscribers.get(event.model);
  if (handler) {
    handler(event);
    return true;
  }
  // Also try wildcard
  const wildcard = client.subscribers.get("*");
  if (wildcard && event.model !== "*") {
    wildcard(event);
    return true;
  }
  return false;
};
