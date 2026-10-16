import type { TUI } from "@earendil-works/pi-tui";
import { vi } from "vitest";

/** Minimal TUI mock — stubs only the methods tests actually call. */
export const createMockTui = (): TUI =>
  ({ requestRender: vi.fn() }) as unknown as TUI;
