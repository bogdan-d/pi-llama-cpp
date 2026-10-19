import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { SettingsStore } from "../../src/settings/store";
import { SettingsWriter } from "../../src/settings/writer";

const mockAccess = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  access: mockAccess,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  rename: mockRename,
}));

const MOCK_PROJECT_PATH = "/fake/project/.pi/settings.json";
const MOCK_GLOBAL_PATH = "/fake/global/settings.json";

const createMockSettingsManager = (): SettingsManager =>
  ({ reload: vi.fn() }) as unknown as SettingsManager;

const createMockStore = (
  path: string,
  content: string = "{}",
): SettingsStore => {
  const store = new SettingsStore(path);
  // Patch the internal read by replacing readFile mock
  mockReadFile.mockImplementation(async () => {
    // We can't easily distinguish paths in the mock, so tests set content globally
    return content;
  });
  mockWriteFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  return store;
};

describe("SettingsWriter", () => {
  let manager: SettingsManager;
  let projectStore: SettingsStore;
  let globalStore: SettingsStore;
  let writer: SettingsWriter;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createMockSettingsManager();
    projectStore = createMockStore(MOCK_PROJECT_PATH);
    globalStore = createMockStore(MOCK_GLOBAL_PATH);
    writer = new SettingsWriter(manager, globalStore, projectStore);
  });

  describe("setLlamaSettings", () => {
    it("should write to project settings when the project file exists", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue("{}");

      await writer.setLlamaSettings({ sortBy: "asc" });

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${MOCK_PROJECT_PATH}.tmp`,
        expect.stringContaining('"llamaSettings"'),
        "utf-8",
      );
      expect(mockRename).toHaveBeenCalledWith(
        `${MOCK_PROJECT_PATH}.tmp`,
        MOCK_PROJECT_PATH,
      );
      expect(manager.reload).toHaveBeenCalled();
    });

    it("should write to global settings when no project file exists", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockReadFile.mockResolvedValue("{}");

      await writer.setLlamaSettings({ sortBy: "desc" });

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${MOCK_GLOBAL_PATH}.tmp`,
        expect.stringContaining('"llamaSettings"'),
        "utf-8",
      );
      expect(mockRename).toHaveBeenCalledWith(
        `${MOCK_GLOBAL_PATH}.tmp`,
        MOCK_GLOBAL_PATH,
      );
      expect(manager.reload).toHaveBeenCalled();
    });

    it("should merge partial settings into existing ones", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ llamaSettings: { sortBy: "asc" } }),
      );

      await writer.setLlamaSettings({ showServerUrls: true });

      const [, written] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(written as string);
      expect(parsed.llamaSettings).toEqual({
        sortBy: "asc",
        showServerUrls: true,
      });
    });

    it("should start from empty object when current settings are non-object", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('{"llamaSettings":"invalid"}');

      await writer.setLlamaSettings({ sortBy: "asc" });

      const [, written] = mockWriteFile.mock.calls[0];
      expect(JSON.parse(written as string)).toEqual({
        llamaSettings: { sortBy: "asc" },
      });
    });
  });

  describe("deleteLlamaSetting", () => {
    it("should remove the specified key from llamaSettings", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          llamaSettings: { sortBy: "asc", showServerUrls: true },
        }),
      );

      await writer.deleteLlamaSetting("sortBy");

      const [, written] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(written as string);
      expect(parsed.llamaSettings).toEqual({ showServerUrls: true });
      expect(manager.reload).toHaveBeenCalled();
    });

    it("should use global store when no project file exists", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockReadFile.mockResolvedValue(
        JSON.stringify({ llamaSettings: { sortBy: "asc" } }),
      );

      await writer.deleteLlamaSetting("sortBy");

      expect(mockRename).toHaveBeenCalledWith(
        `${MOCK_GLOBAL_PATH}.tmp`,
        MOCK_GLOBAL_PATH,
      );
    });
  });
});
