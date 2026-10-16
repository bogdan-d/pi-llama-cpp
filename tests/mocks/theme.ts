import type { Theme } from "@earendil-works/pi-coding-agent";

/** Minimal Theme mock — stubs only the methods tests actually call. */
export const createMockTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }) as unknown as Theme;
