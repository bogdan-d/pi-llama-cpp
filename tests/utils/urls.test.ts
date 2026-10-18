import { describe, expect, it } from "vitest";
import { ServerUrl } from "../../src/utils/urls";

describe("ServerUrl", () => {
  describe("normalize", () => {
    it("trims surrounding whitespace", () => {
      expect(ServerUrl.normalize("  http://localhost:8080  ")).toBe(
        "http://localhost:8080",
      );
    });

    it("strips trailing slashes", () => {
      expect(ServerUrl.normalize("http://localhost:8080/")).toBe(
        "http://localhost:8080",
      );
      expect(ServerUrl.normalize("http://localhost:8080///")).toBe(
        "http://localhost:8080",
      );
      expect(ServerUrl.normalize("http://localhost:8080//path//")).toBe(
        "http://localhost:8080//path",
      );
    });

    it("leaves clean URLs unchanged", () => {
      expect(ServerUrl.normalize("http://localhost:8080")).toBe(
        "http://localhost:8080",
      );
    });
  });

  describe("isValid", () => {
    it("accepts http URLs", () => {
      expect(ServerUrl.isValid("http://localhost:8080")).toBe(true);
    });

    it("accepts https URLs", () => {
      expect(ServerUrl.isValid("https://example.com")).toBe(true);
    });

    it("rejects URLs without http scheme", () => {
      expect(ServerUrl.isValid("ftp://localhost")).toBe(false);
      expect(ServerUrl.isValid("file:///path")).toBe(false);
      expect(ServerUrl.isValid("localhost:8080")).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(ServerUrl.isValid("")).toBe(false);
    });
  });

  describe("parse", () => {
    it("returns normalized URL for valid input", () => {
      expect(ServerUrl.parse("http://localhost:8080/")).toBe(
        "http://localhost:8080",
      );
    });

    it("returns null for empty strings", () => {
      expect(ServerUrl.parse("")).toBe(null);
      expect(ServerUrl.parse("   ")).toBe(null);
    });

    it("returns null for URLs with semicolons", () => {
      expect(ServerUrl.parse("http://localhost:8080;other")).toBe(null);
    });

    it("returns null for URLs without http scheme", () => {
      expect(ServerUrl.parse("ftp://localhost")).toBe(null);
      expect(ServerUrl.parse("localhost")).toBe(null);
    });
  });
});
