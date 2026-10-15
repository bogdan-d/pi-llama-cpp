import type { ServerFactory } from "../../src/servers/serverFactory";
import type { BaseModel } from "../../src/models/baseModel";
import { createMockServer } from "./server";

/**
 * Creates a default `ServerFactory` that produces unseeded mock servers.
 */
export const createServerFactory = (): ServerFactory => ({
  create: (resolver) => createMockServer(resolver),
});

/**
 * Creates a `ServerFactory` that seeds models and optional disconnect stubs
 * into each constructed server, keyed by baseUrl.
 */
export const createSeededServerFactory = (
  models: Record<string, BaseModel[]>,
  disconnects?: Record<string, () => void>,
): ServerFactory => ({
  create: (resolver, options) => {
    const server = createMockServer(
      resolver,
      {
        baseUrl: options.baseUrl,
        customId: options.customId,
        customName: options.customName,
        overrides: options.overrides,
      },
      models[options.baseUrl],
    );
    if (disconnects?.[options.baseUrl]) {
      (server as any).sse = { disconnect: disconnects[options.baseUrl] };
    }
    return server;
  },
});
