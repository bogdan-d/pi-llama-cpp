import { vi } from "vitest";

/**
 * Builds an injectable `fetch` stub keyed by endpoint path.
 *
 * Use it to construct an `ApiClient` with a mock `fetchFn` so the real
 * `ApiClient` logic (caching, deduplication, error handling) is exercised
 * while the HTTP layer is mocked.
 *
 * @param responses — Map of endpoint → response JSON (or function that
 *   receives the full URL and returns JSON)
 * @returns A `vi.fn<typeof globalThis.fetch>` ready to pass to `ApiClient`
 */
export const makeMockFetch = (
  responses: Record<string, unknown> | ((url: string) => unknown),
): ReturnType<typeof vi.fn> =>
  vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href);

    let data: unknown;
    if (typeof responses === "function") {
      data = responses(href);
    } else {
      // Try exact match first, then prefix match
      data = responses[url.pathname + url.search];
      if (data === undefined) {
        for (const [key, val] of Object.entries(responses)) {
          if (href.startsWith(key)) {
            data = val;
            break;
          }
        }
      }
    }

    return new Response(JSON.stringify(data ?? {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

/**
 * Builds an injectable `fetch` implementation that routes every request
 * into the provided `rpcMock`, keyed by the endpoint path + query (and
 * parsed body for POSTs). Responses always come back as 200 JSON; SSE
 * probes therefore see a non-event-stream content type and fall back to
 * polling.
 *
 * The returned function is injected via `Server`'s/`ApiClient`'s
 * `fetchFn` parameter — no global state is touched.
 *
 * @param rpcMock — The per-file mock RPC function (use `mockRpc` from
 *   `../mocks/mockRpc` for isolation across parallel test files).
 * @returns A `fetch`-compatible function to pass as `fetchFn`
 */
export const createRpcFetch = (
  rpcMock: (endpoint: string, ...args: unknown[]) => Promise<unknown>,
): ReturnType<typeof vi.fn> & typeof globalThis.fetch =>
  vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const { pathname, search } = new URL(href);
      const endpoint = `${pathname}${search}`;
      // Only pass the body argument when present, so call assertions like
      // `toHaveBeenCalledWith("/v1/models")` match single-argument calls.
      const data =
        typeof init?.body === "string"
          ? await rpcMock(endpoint, JSON.parse(init.body))
          : await rpcMock(endpoint);
      return new Response(JSON.stringify(data ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
