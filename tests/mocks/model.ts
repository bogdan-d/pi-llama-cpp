import { vi } from "vitest";
import { Status } from "../../src/enums/status";
import { Mode } from "../../src/enums/mode";
import type { Model } from "../../src/models/model";
import type { Server } from "../../src/servers/server";
import { defaultBaseUrl } from "../constants";

/**
 * Lightweight stub of {@link Model} for non-model tests that need a
 * model-like object but don't exercise model methods.
 */
export const createMockModel = <T extends Model>(
  name: string,
  overrides: Partial<T> = {},
): T =>
  ({
    name,
    id: name,
    serverUrl: defaultBaseUrl(),
    serverId: "test-provider",
    server: { mode: Mode.ROUTER } as unknown as Server,
    reasoning: true,
    getStatus: vi.fn().mockResolvedValue(Status.LOADED),
    getContextSize: vi.fn().mockResolvedValue(4096),
    getInfo: vi.fn().mockResolvedValue(`Model: ${name}\nID: ${name}`),
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    toProviderConfig: vi.fn().mockResolvedValue({}),
    getLabel: vi.fn().mockResolvedValue(name),
    getCapabilities: vi
      .fn()
      .mockResolvedValue(["text"] as ("text" | "image")[]),
    ...overrides,
  }) as unknown as T;
