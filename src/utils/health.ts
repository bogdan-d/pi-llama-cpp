import { ENDPOINT_PREFIX } from "../constants";
import { ServerStatus } from "../enums/serverStatus";

/**
 * Probes a llama-server's `/health` endpoint and classifies the outcome.
 *
 * The single source of truth for health classification — both
 * `Server.isReady` and the UI health indicators delegate here.
 *
 * Runs health and auth checks in parallel via `Promise.allSettled`.
 *
 * - Health fails (timeout)    → `TIMEOUT`
 * - Health fails (error)      → `UNREACHABLE`
 * - Health OK + auth 401      → `UNAUTHORIZED` (server reachable but needs an API key)
 * - Health OK + auth OK       → `READY`
 *
 * The HTTP status code itself is not inspected: a llama-server answers
 * `/health` with the payload's `status` field, and both classification
 * branches key off it (matching the behavior of `ApiClient.get`, which
 * also ignores status codes and parses the body).
 *
 * @param url The bare origin of the llama-server (the endpoint is
 *   `<url>/health`, without the `/v1` prefix)
 * @param timeout Maximum time (ms) for both health and auth probes
 * @param apiKey Optional API key, sent as a Bearer token — servers
 *   behind an API-key gate would otherwise report UNREACHABLE
 * @returns The classified server status
 */
export const checkServerHealth = async (
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<ServerStatus> => {
  const healthPromise = probeHealth(url, timeout, apiKey);
  const authPromise = probeAuth(url, timeout, apiKey);

  const [healthResult, authResult] = await Promise.allSettled([
    healthPromise,
    authPromise,
  ]);

  // Health failed — return based on failure type
  if (healthResult.status === "rejected") {
    const isTimeout =
      healthResult.reason?.name === "TimeoutError" ||
      healthResult.reason?.name === "AbortError";
    return isTimeout ? ServerStatus.TIMEOUT : ServerStatus.UNREACHABLE;
  }

  if (!healthResult.value) {
    return ServerStatus.UNREACHABLE;
  }

  // Health OK — check auth
  if (authResult.status === "fulfilled" && authResult.value === 401) {
    return ServerStatus.UNAUTHORIZED;
  }

  return ServerStatus.READY;
};

/**
 * Probes the `/health` endpoint. Returns `true` on success, `false` on
 * non-ok response. Throws on timeout or network error.
 */
async function probeHealth(
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<boolean> {
  const response = await fetch(`${url}/health`, {
    signal: AbortSignal.timeout(timeout),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  return response.ok;
}

/**
 * Probes the `/v1/models` endpoint to check if authentication is required.
 * Returns the HTTP status code. Throws on timeout or network error.
 */
async function probeAuth(
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<number> {
  const response = await fetch(`${url}${ENDPOINT_PREFIX}/models`, {
    signal: AbortSignal.timeout(timeout),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  return response.status;
}
