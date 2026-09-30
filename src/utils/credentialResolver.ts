import { execSync } from "node:child_process";

import { API_KEY_PLACEHOLDER } from "../constants";

/**
 * Resolves credential API keys from `auth.json` entries.
 *
 * Supports four formats:
 * - **Literal** — `"sk-abc123"` used as-is
 * - **Shell command** — `"!cat ~/.secrets/key"` executes and captures stdout
 * - **Env ref** — `"$VAR"` or `"${VAR}"` resolved from `credential.env` then `process.env`
 * - **Escape** — `"$$literal"` → `"$literal"`, `"$!bang"` → `"!bang"`
 */
export class CredentialResolver {
  /**
   * Resolves a credential key to its actual value.
   *
   * @param key - The raw key string from the credential
   * @param env - Optional env map from `credential.env`. Checked before `process.env`.
   * @returns The resolved API key value, or the placeholder on failure.
   */
  resolve(key: string, env?: Record<string, string>): string {
    if (!key) return API_KEY_PLACEHOLDER;

    if (key.startsWith("!")) return this.resolveShellCommand(key);
    if (key.startsWith("$$")) return this.resolveEscape(key);
    if (key.startsWith("$!")) return this.resolveEscape(key);
    if (!key.startsWith("$")) return key;

    return this.resolveEnvRef(key, env) ?? API_KEY_PLACEHOLDER;
  }

  /**
   * Executes a shell command and returns its trimmed stdout.
   *
   * Strips the leading `!` and runs the remainder as a shell command.
   * On failure (non-zero exit or exception), returns the placeholder.
   *
   * @param command - The full key string starting with `!` (e.g. `"!cat ~/.secrets/key"`).
   * @returns The trimmed stdout, or the API key placeholder on failure.
   *
   * @example
   * ```ts
   * resolveShellCommand("!echo my-secret")    // → "my-secret"
   * resolveShellCommand("!cat ~/.key")        // → contents of file
   * resolveShellCommand("!invalid/cmd")       // → API_KEY_PLACEHOLDER
   * ```
   */
  private resolveShellCommand(command: string): string {
    try {
      return (
        execSync(command.slice(1), {
          encoding: "utf-8",
          timeout: 10_000,
        }).trim() || API_KEY_PLACEHOLDER
      );
    } catch {
      return API_KEY_PLACEHOLDER;
    }
  }

  /**
   * Resolves escape sequences: `$$` → literal `$`, `$!` → literal `!`.
   *
   * Replaces the leading escape marker with the literal character and
   * preserves any remaining text.
   *
   * @param key - A key string starting with `$$` or `$!`.
   * @returns The literal character followed by the rest of the string.
   *
   * @example
   * ```ts
   * resolveEscape("$$literal")   // → "$literal"
   * resolveEscape("$!bang")      // → "!bang"
   * ```
   */
  private resolveEscape(key: string): string {
    return key.charAt(1) + key.slice(2);
  }

  /**
   * Resolves `$VAR` or `${VAR}` syntax to the corresponding environment value.
   *
   * Matches the entire key against `$VAR` or `${VAR}` patterns. Looks up the
   * variable first in the provided `env` map, then falls back to `process.env`.
   *
   * @param key - The key string containing a `$VAR` or `${VAR}` reference.
   * @param env - Optional env map (e.g. from `credential.env`). Checked before `process.env`.
   * @returns The resolved environment value, or `undefined` if the var is not found or the format is invalid.
   *
   * @example
   * ```ts
   * resolveEnvRef("$API_KEY", { API_KEY: "abc" })     // → "abc"
   * resolveEnvRef("${API_KEY}", process.env)           // → process.env.API_KEY
   * resolveEnvRef("$UNSET")                            // → undefined
   * resolveEnvRef("$invalid-var!")                    // → undefined (invalid name)
   * ```
   */
  private resolveEnvRef(
    key: string,
    env?: Record<string, string>,
  ): string | undefined {
    const match =
      key.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/) ??
      key.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
    const varName = match?.[1];
    if (!varName) return undefined;
    return env?.[varName] ?? process.env[varName];
  }
}
