import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { Server } from "./server";

/**
 * Server subclass for llama.cpp routers (multi-model mode).
 *
 * Uses the same status resolution as `SingleServer` but extracts
 * context size from the model's CLI args when unloaded.
 */
export class RouterServer extends Server {
  override mode: Mode = Mode.ROUTER;

  /**
   * Resolves capabilities using `/props` with a fallback to `/v1/models`
   * architecture input_modalities.
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
      const { modalities } = await this.fetchModelProps(modelId);
      return modalities.vision ? ["text", "image"] : ["text"];
    } catch {
      const { data } = await this.fetchModels();
      const model = data.find((d) => d.id === modelId);
      if (!model) return ["text"];
      const input_modalities = model.architecture?.input_modalities ?? ["text"];
      return input_modalities.filter(
        (mod): mod is "text" | "image" => mod === "text" || mod === "image",
      );
    }
  }

  /**
   * Orchestrate model loading (HTTP call + SSE or polling wait).
   *
   * @param modelId — The model ID to load.
   * @throws When the model fails to load.
   */
  override async loadModel(modelId: string): Promise<void> {
    const status = await this.getModelStatus(modelId);
    if (status === Status.LOADED || status === Status.SLEEPING) return;

    await this.postRequest("load", modelId);

    // SSE or polling fallback
    const sse = this.sseManager;
    if (sse) {
      try {
        const { status: sseStatus, exit_code } =
          await sse.subscribeToStatus(modelId);
        if (
          sseStatus === "failed" ||
          (sseStatus === "unloaded" && exit_code !== 0)
        ) {
          throw new Error(`Model loading failed: ${modelId}`);
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("Model loading failed")
        ) {
          throw err;
        }
        await this.pollModelStatus(modelId, Status.LOADED);
        const finalStatus = await this.getModelStatus(modelId);
        if (finalStatus !== Status.LOADED && finalStatus !== Status.SLEEPING) {
          throw new Error(`Model loading failed: ${modelId}`);
        }
      }
    } else {
      await this.pollModelStatus(modelId, Status.LOADED);
    }
  }

  /**
   * Resolves context size from meta when loaded, or from CLI args
   * (--ctx-size, --fit-ctx) when unloaded.
   *
   * @param modelId — The model ID.
   * @returns The resolved context size.
   */
  override async getContextSize(modelId: string): Promise<number> {
    const overridden = this.findOverrideForModel(modelId)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    if ((await this.getModelStatus(modelId)) === Status.LOADED) {
      try {
        const { data } = await this.fetchModels();
        return data.find((m) => m.id === modelId)?.meta?.n_ctx ?? FALLBACK_CTX;
      } catch {
        return FALLBACK_CTX;
      }
    }

    const { data } = await this.fetchModels();
    const model = data.find((m) => m.id === modelId);
    const args = model?.status?.args;
    if (!args) return FALLBACK_CTX;

    const ctxIdx = args.indexOf("--ctx-size");
    if (ctxIdx !== -1 && args.length > ctxIdx + 1) {
      const parsed = parseInt(args[ctxIdx + 1], 10);
      if (!isNaN(parsed)) return parsed;
    }

    const fitIdx = args.indexOf("--fit-ctx");
    if (fitIdx !== -1 && args.length > fitIdx + 1) {
      const parsed = parseInt(args[fitIdx + 1], 10);
      if (!isNaN(parsed)) return parsed;
    }

    return FALLBACK_CTX;
  }
}
