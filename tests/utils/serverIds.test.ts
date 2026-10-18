import { describe, expect, it } from "vitest";
import { ServerIds } from "../../src/utils/serverIds";

describe("ServerIds", () => {
  describe("fromUrl", () => {
    it("returns the provider prefix with the URL", () => {
      expect(ServerIds.fromUrl("http://localhost:8080")).toBe(
        "llama-server=http://localhost:8080",
      );
    });

    it("handles URLs with paths", () => {
      expect(ServerIds.fromUrl("http://example.com/api")).toBe(
        "llama-server=http://example.com/api",
      );
    });
  });

  describe("resolve", () => {
    it("returns customId when provided", () => {
      expect(ServerIds.resolve("http://localhost:8080", "my-custom-id")).toBe(
        "my-custom-id",
      );
    });

    it("falls back to URL-derived ID when customId is undefined", () => {
      expect(ServerIds.resolve("http://localhost:8080")).toBe(
        "llama-server=http://localhost:8080",
      );
    });

    it("falls back to URL-derived ID when customId is an empty string", () => {
      expect(ServerIds.resolve("http://localhost:8080", "")).toBe("");
    });
  });
});
