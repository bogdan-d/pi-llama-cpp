import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** Create a mock extension context typed as `ExtensionCommandContext`.
 * Casts once at the source so test bodies stay clean. */
export const createMockCtx = (
  selectFn: (prompt: string, options: string[]) => string | null,
): ExtensionCommandContext =>
  ({
    mode: "tui",
    cwd: "/tmp/test",
    ui: {
      select: vi.fn(selectFn),
      notify: vi.fn(),
      custom: vi.fn(),
      theme: {
        fg: (_color: string, text: string) => text,
      },
    },
    modelRegistry: {
      find: vi.fn().mockReturnValue({ id: "test-model-id" }),
    },
  }) as unknown as ExtensionCommandContext;

/** Create a mock Pi instance typed as `ExtensionAPI`.
 * Stubs the methods tests commonly call; pass extras via `overrides`.
 * Absent methods throw `undefined is not a function` at call site so
 * missing stubs fail fast instead of silently crashing mid-test. */
export const createMockPi = (
  overrides: Partial<ExtensionAPI> = {},
): ExtensionAPI =>
  ({
    setModel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    registerCommand: vi.fn(),
    ...overrides,
  }) as unknown as ExtensionAPI;

/** Create a mock `ExtensionCommandContext` with a `mode` override. */
export const createMockCommandCtx = (
  selectFn: (prompt: string, options: string[]) => string | null,
  overrides?: Partial<ExtensionCommandContext>,
): ExtensionCommandContext =>
  ({
    ...createMockCtx(selectFn),
    ...overrides,
  }) as unknown as ExtensionCommandContext;

/** Create a mock Pi context for EventManager */
export const createMockPiContext = (notifyFn: ReturnType<typeof vi.fn>) =>
  ({
    ui: {
      notify: notifyFn,
    },
  }) as any as ExtensionContext;
