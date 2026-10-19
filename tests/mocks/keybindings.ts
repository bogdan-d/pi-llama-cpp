import type { KeybindingsManager } from "@earendil-works/pi-tui";
import { vi } from "vitest";

/** Minimal KeybindingsManager mock — stubs only the methods tests actually call. */
export const createMockKeybindings = (): KeybindingsManager =>
  ({ matches: vi.fn() }) as unknown as KeybindingsManager;
