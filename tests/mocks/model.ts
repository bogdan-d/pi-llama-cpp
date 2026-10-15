import { vi } from "vitest";
import { Mode } from "../../src/enums/mode";
import { Status } from "../../src/enums/status";
import type { BaseModel } from "../../src/models/baseModel";
import { defaultBaseUrl } from "../constants";

/**
 * Lightweight stub of {@link BaseModel} for non-model tests that need a
 * model-like object but don't exercise model methods.
 */
export const createMockModel = <T extends BaseModel>(
  name: string,
  overrides: Partial<T> = {},
): T =>
  ({
    name,
    id: name,
    mode: Mode.ROUTER,
    serverUrl: defaultBaseUrl(),
    capabilities: ["text"] as ["text"],
    getStatus: vi.fn().mockResolvedValue(Status.LOADED),
    getContextSize: vi.fn().mockResolvedValue(4096),
    getInfo: vi.fn().mockResolvedValue(`Model: ${name}\nID: ${name}`),
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    toProviderConfig: vi.fn().mockResolvedValue({}),
    getLabel: vi.fn().mockResolvedValue(name),
    ...overrides,
  }) as unknown as T;
