import { describe, expect, it } from "vitest";
import { CredentialResolver } from "../../src/utils/credentialResolver";

describe("CredentialResolver", () => {
  const resolver = new CredentialResolver();

  describe("resolve", () => {
    it("returns placeholder for empty key", () => {
      expect(resolver.resolve("")).toBe("sk-placeholder");
      expect(resolver.resolve(undefined as any)).toBe("sk-placeholder");
    });

    it("returns literal key as-is", () => {
      expect(resolver.resolve("sk-abc123")).toBe("sk-abc123");
      expect(resolver.resolve("plain-key-without-dollars")).toBe(
        "plain-key-without-dollars",
      );
    });

    it("resolves escape sequences $$", () => {
      expect(resolver.resolve("$$literal")).toBe("$literal");
    });

    it("resolves escape sequences $!", () => {
      expect(resolver.resolve("$!bang")).toBe("!bang");
    });

    it("resolves $VAR from credential.env", () => {
      expect(resolver.resolve("$MY_KEY", { MY_KEY: "from-env" })).toBe(
        "from-env",
      );
    });

    it("resolves ${VAR} from credential.env", () => {
      expect(resolver.resolve("${MY_KEY}", { MY_KEY: "from-env" })).toBe(
        "from-env",
      );
    });

    it("resolves $VAR from process.env as fallback", () => {
      process.env.TEST_PROCESS_VAR = "process-value";
      expect(resolver.resolve("$TEST_PROCESS_VAR")).toBe("process-value");
      delete process.env.TEST_PROCESS_VAR;
    });

    it("prioritizes credential.env over process.env", () => {
      process.env.PREF_KEY = "process-value";
      expect(
        resolver.resolve("$PREF_KEY", { PREF_KEY: "credential-value" }),
      ).toBe("credential-value");
      delete process.env.PREF_KEY;
    });

    it("returns placeholder when env var is missing", () => {
      expect(resolver.resolve("$UNSET_VAR")).toBe("sk-placeholder");
      expect(resolver.resolve("${UNSET_VAR}", { OTHER_KEY: "value" })).toBe(
        "sk-placeholder",
      );
    });

    it("returns placeholder for invalid env var syntax", () => {
      expect(resolver.resolve("$123invalid")).toBe("sk-placeholder");
      expect(resolver.resolve("$has-dash")).toBe("sk-placeholder");
    });
  });
});
