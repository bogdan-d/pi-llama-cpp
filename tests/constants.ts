/**
 * Default port for the llama.cpp server used in tests.
 * Mirrors {@link ../../src/constants}.LLAMA_SERVER_URL so the two stay in sync.
 */
export const DEFAULT_PORT = 9931;

/**
 * Build the default server URL from {@link DEFAULT_PORT}.
 */
export function defaultBaseUrl(host = "127.0.0.1"): string {
  return `http://${host}:${DEFAULT_PORT}`;
}
