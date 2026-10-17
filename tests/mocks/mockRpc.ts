import { vi } from "vitest";

/** Creates an isolated mock RPC per test file. Parallel test files
 * each call this once (typically at the top of the file) to get their
 * own `vi.fn()` instance, preventing cross-test pollution. */
export const createMockRpc = () => vi.fn();
