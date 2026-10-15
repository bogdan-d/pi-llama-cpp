import { vi } from "vitest";

/** Shared mock RPC — each test configures it */
export const mockRpc = vi.fn();

/**
 * Installs a global `fetch` stub that routes every request into the shared
 * `mockRpc`, keyed by the endpoint path + query (and parsed body for POSTs) —
 * the same contract the old fake clients used, so tests keep configuring
 * responses on `mockRpc`. Responses always come back as 200 JSON; SSE probes
 * therefore see a non-event-stream content type and fall back to polling.
 * Tests asserting raw fetch behavior (health classification, SSE streaming)
 * install their own stub instead, as before.
 */
export const installFetchStub = (): void => {
  vi.stubGlobal(
    "fetch",
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
            ? await mockRpc(endpoint, JSON.parse(init.body))
            : await mockRpc(endpoint);
        return new Response(JSON.stringify(data ?? {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ),
  );
};
