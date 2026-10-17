import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Server } from "./server";

/**
 * Server subclass for legacy llama.cpp servers (e.g. `ik_llama.cpp`).
 *
 * Resolves context size from `/props` (n_ctx) and `/v1/models`
 * (max_model_len), falling back to the legacy single-server path
 * for capabilities.
 */
export class LegacyServer extends Server {
  override mode: Mode = Mode.LEGACY;

  /**
   * Resolves capabilities using `/props` with a legacy fallback to
   * `/v1/models` capabilities array.
   *
   * @param modelId — The model ID.
   * @returns The resolved capabilities.
   */
  override async getCapabilities(
    modelId: string,
  ): Promise<("text" | "image")[]> {
    const overridden = this.findOverrideForModel(modelId)?.capabilities;
    if (overridden) return overridden;

    try {
      // Try standard path first
      const { modalities } = await this.fetchModelProps(modelId);

      return modalities.vision ? ["text", "image"] : ["text"];
    } catch {
      // Legacy fallback
      const { models } = await this.fetchModels();
      const [{ capabilities }] = models!;
      const hasImage = capabilities.includes("multimodal");

      return hasImage ? ["text", "image"] : ["text"];
    }
  }

  /**
   * Resolves context size from `/props` (n_ctx) or `/v1/models`
   * (max_model_len), preferring max_model_len when non-zero.
   *
   * @param modelId — The model ID.
   * @returns The resolved context size.
   */
  override async getContextSize(modelId: string): Promise<number> {
    const overridden = this.findOverrideForModel(modelId)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    const props = await this.fetchModelProps(modelId);
    const { data } = await this.fetchModels();
    const { n_ctx } = props as unknown as { n_ctx: number };
    const [{ max_model_len }] = data as unknown as {
      max_model_len: number;
    }[];
    const contextSize = max_model_len === 0 ? n_ctx : max_model_len;

    return contextSize ?? FALLBACK_CTX;
  }
}
