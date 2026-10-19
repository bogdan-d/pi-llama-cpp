import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Server } from "./server";

/**
 * Server subclass for standard llama.cpp servers (single-model mode).
 *
 * Detects capabilities from `/props` with a fallback to `/v1/models`,
 * resolves context size from `/v1/models` meta, and uses the standard
 * `/props` endpoint for status.
 */
export class SingleServer extends Server {
  override mode: Mode = Mode.SINGLE;

  /**
   * Resolves context size from `/v1/models` meta n_ctx.
   *
   * @param modelId — The model ID.
   * @returns The resolved context size.
   */
  override async getContextSize(modelId: string): Promise<number> {
    const overridden = this.findOverrideForModel(modelId)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    try {
      const { data } = await this.fetchModels();
      return data.find((m) => m.id === modelId)?.meta?.n_ctx ?? FALLBACK_CTX;
    } catch {
      return FALLBACK_CTX;
    }
  }
}
