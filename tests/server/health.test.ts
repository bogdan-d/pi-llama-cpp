import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerStatus } from "../../src/enums/serverStatus";
import { Server } from "../../src/server";

/**
 * Stubs `global.fetch` for one test. Responses are plain objects; only
 * `status` (health probe) and `json()` (auth probe) are consumed.
 */
const stubFetch = (
  impl: (url: string, init?: RequestInit) => Promise<unknown>,
) => vi.stubGlobal("fetch", vi.fn(impl));

const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) });

const URL_ = "http://127.0.0.1:9931";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Server.check", () => {
  it("should return READY when health and auth succeed", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      return okResponse();
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.READY);
  });

  it("should return UNAUTHORIZED when health succeeds but auth fails", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      return { ok: false, status: 401, json: async () => ({}) };
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.UNAUTHORIZED);
  });

  it("should return UNREACHABLE when health returns a non-200 status", async () => {
    // llama-server answers 503 while a model is loading
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE on a network error", async () => {
    stubFetch(async () => {
      throw new Error("connection refused");
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return TIMEOUT when the health fetch aborts with TimeoutError", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.TIMEOUT);
  });

  it("should return TIMEOUT when the health fetch aborts with AbortError", async () => {
    // Some runtimes surface the timeout as a plain AbortError
    stubFetch(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.TIMEOUT);
  });

  it("should return UNREACHABLE when the auth probe fails", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      throw new Error("connection refused");
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return TIMEOUT when the auth probe aborts", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.TIMEOUT);
  });

  it("should treat any non-401 auth response as success", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      return { ok: false, status: 500, json: async () => ({}) };
    });

    expect(await Server.check(URL_, 1000)).toBe(ServerStatus.READY);
  });

  it("should hit <url>/health with a Bearer token", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await Server.check(URL_, 1000, "secret-key");

    expect(fetchMock).toHaveBeenCalledWith(`${URL_}/health`, {
      signal: expect.any(AbortSignal),
      method: "GET",
      headers: { Authorization: "Bearer secret-key" },
    });
  });

  it("should probe /v1/models for auth when health succeeds", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/health")) return okResponse();
      return okResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await Server.check(URL_, 1000, "secret-key");

    expect(fetchMock).toHaveBeenCalledWith(`${URL_}/v1/models`, {
      signal: expect.any(AbortSignal),
      method: "GET",
      headers: { Authorization: "Bearer secret-key" },
    });
  });

  it("should send an empty Bearer token when no key is given", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await Server.check(URL_, 1000);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer ",
    });
  });
});
