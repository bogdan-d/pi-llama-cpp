import { describe, expect, it, vi } from "vitest";
import { buildAuthHeaders, openSSEStream } from "../../src/sse/fetch";

describe("buildAuthHeaders", () => {
  it("returns empty object when no API key is provided", () => {
    expect(buildAuthHeaders()).toEqual({});
    expect(buildAuthHeaders(undefined)).toEqual({});
  });

  it("returns Bearer header when API key is provided", () => {
    expect(buildAuthHeaders("sk-abc")).toEqual({
      Authorization: "Bearer sk-abc",
    });
  });
});

describe("openSSEStream", () => {
  it("returns the response body for a successful response", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockBody,
    }) as typeof globalThis.fetch;

    const stream = await openSSEStream(
      "http://localhost:8080/sse",
      "sk-key",
      undefined,
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8080/sse", {
      method: "GET",
      headers: { Authorization: "Bearer sk-key" },
      signal: undefined,
    });

    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toEqual(new TextEncoder().encode("data"));
  });

  it("includes auth headers when apiKey is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }) as typeof globalThis.fetch;

    await openSSEStream(
      "http://localhost:8080/sse",
      "my-key",
      undefined,
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/sse",
      expect.objectContaining({
        headers: { Authorization: "Bearer my-key" },
      }),
    );
  });

  it("includes no auth headers when apiKey is undefined", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }) as typeof globalThis.fetch;

    await openSSEStream(
      "http://localhost:8080/sse",
      undefined,
      undefined,
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/sse",
      expect.objectContaining({
        headers: {},
      }),
    );
  });

  it("cancels body and throws on non-ok response", async () => {
    const cancel = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: { cancel },
    }) as typeof globalThis.fetch;

    await expect(
      openSSEStream(
        "http://localhost:8080/sse",
        undefined,
        undefined,
        mockFetch,
      ),
    ).rejects.toThrow("SSE connection failed: HTTP 500");

    expect(cancel).toHaveBeenCalled();
  });
});
