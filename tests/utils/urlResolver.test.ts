import { beforeEach, describe, expect, it } from "vitest";
import { UrlResolver } from "../../src/utils/urlResolver";

function createResolver(
  getLlamaSettings: () => Promise<Record<string, unknown>>,
  getMergedSettings: () => Promise<Record<string, unknown>>,
) {
  return new UrlResolver({ getLlamaSettings, getMergedSettings });
}

describe("UrlResolver", () => {
  beforeEach(() => {
    delete process.env.LLAMA_SERVER_URL;
  });

  describe("resolveUrls", () => {
    it("falls back to default when nothing is configured", async () => {
      const resolver = createResolver(
        () => Promise.resolve({}),
        () => Promise.resolve({}),
      );

      const result = await resolver.resolveUrls();
      expect(result).toEqual(["http://127.0.0.1:8080"]);
    });

    it("prioritizes env variable over all config sources", async () => {
      process.env.LLAMA_SERVER_URL = "http://env:9090";
      const resolver = createResolver(
        () =>
          Promise.resolve({
            servers: [{ url: "http://servers:8080" }],
          }),
        () => Promise.resolve({ llamaServerUrl: "http://legacy:7070" }),
      );

      const result = await resolver.resolveUrls();
      expect(result).toEqual(["http://env:9090"]);
    });

    it("prioritizes llamaSettings.servers over legacy llamaServerUrl", async () => {
      const resolver = createResolver(
        () =>
          Promise.resolve({
            servers: [{ url: "http://servers:8080" }],
          }),
        () => Promise.resolve({ llamaServerUrl: "http://legacy:7070" }),
      );

      const result = await resolver.resolveUrls();
      expect(result).toEqual(["http://servers:8080"]);
    });

    it("falls back to legacy when servers is empty", async () => {
      const resolver = createResolver(
        () => Promise.resolve({ servers: [] }),
        () => Promise.resolve({ llamaServerUrl: "http://legacy:7070" }),
      );

      const result = await resolver.resolveUrls();
      expect(result).toEqual(["http://legacy:7070"]);
    });

    it("returns empty arrays from settings when values are falsy", async () => {
      const resolver = createResolver(
        () => Promise.resolve({ servers: undefined }),
        () => Promise.resolve({ llamaServerUrl: undefined }),
      );

      const result = await resolver.resolveUrls();
      expect(result).toEqual(["http://127.0.0.1:8080"]);
    });
  });

  describe("warnings", () => {
    it("collects warnings for invalid env URLs", async () => {
      process.env.LLAMA_SERVER_URL = "invalid-url;http://good:8080";
      const resolver = createResolver(
        () => Promise.resolve({}),
        () => Promise.resolve({}),
      );

      await resolver.resolveUrls();
      expect(resolver.takeWarnings()).toEqual([
        "Ignoring invalid server URL 'invalid-url' (needs http(s)://)",
      ]);
    });

    it("collects warnings for invalid server URLs", async () => {
      const resolver = createResolver(
        () =>
          Promise.resolve({
            servers: [{ url: "bad-url" }, { url: "http://good:8080" }],
          }),
        () => Promise.resolve({}),
      );

      await resolver.resolveUrls();
      expect(resolver.takeWarnings()).toEqual([
        "Ignoring invalid server URL 'bad-url' (needs http(s)://)",
      ]);
    });

    it("clears warnings after takeWarnings()", async () => {
      process.env.LLAMA_SERVER_URL = "bad;http://good:8080";
      const resolver = createResolver(
        () => Promise.resolve({}),
        () => Promise.resolve({}),
      );

      await resolver.resolveUrls();
      expect(resolver.takeWarnings()).toHaveLength(1);
      expect(resolver.takeWarnings()).toEqual([]);
    });
  });
});
