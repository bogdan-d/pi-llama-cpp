/**
 * This provider's base ID
 */
export const PROVIDER_PREFIX = "llama-server";

/**
 * The settings key used in project/global settings.
 */
export const SETTINGS_KEY = "llamaSettings";

/**
 * This provider's name
 */
export const PROVIDER_NAME = "Llama.cpp";

/**
 * The default API type used in Pi
 */
export const API_TYPE = "openai-completions";

/**
 * The placeholder api-key if it couldn't be resolved
 */
export const API_KEY_PLACEHOLDER = "sk-placeholder";

/**
 * The default URL if the resolver couldn't find it
 */
export const LLAMA_SERVER_URL = "http://127.0.0.1:9931";

/**
 * Endpoint prefix of the OpenAI-compatible API exposed by llama-server.
 * Native routes (/health, /props, /models/sse, ...) live directly under the
 * server root; only OpenAI-dialect consumers (the Pi provider registration
 * and the /models listing) address the API under this prefix.
 */
export const ENDPOINT_PREFIX = "/v1";

/**
 * The default context if the server didn't expose it
 */
export const FALLBACK_CTX = 128000;

/**
 * Reasonable time (ms) to read notifications if context goes stale
 */
export const READABLE_TIMEOUT = 15000;

/**
 * Thinking budgets to send to the server, depending on user-selected level in Pi.
 */
export const THINKING_BUDGETS = {
  off: 0,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: -1,
};
