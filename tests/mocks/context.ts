import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** Create a mock extension context */
export const createMockCtx = (
  selectFn: (prompt: string, options: string[]) => string | null,
) => ({
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
});

/** Create a mock Pi instance */
export const createMockPi = () => ({
  setModel: vi.fn(),
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
});

/** Create a mock Pi context for EventManager */
export const createMockPiContext = (notifyFn: ReturnType<typeof vi.fn>) =>
  ({
    ui: {
      notify: notifyFn,
    },
  }) as any as ExtensionContext;
