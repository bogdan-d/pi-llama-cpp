import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { BaseModel } from "./baseModel";

export class LlamaSwapModel extends BaseModel {
  get mode(): Mode {
    return Mode.LLAMASWAP;
  }

  override get name(): string {
    // llama-swap adds a `llamaswap` key inside `meta` with aliases;
    // fall back to the standard aliases array, then to id
    return (
      this.model.meta?.llamaswap?.aliases?.[0] ??
      this.model.aliases?.[0] ??
      this.model.id
    );
  }

  /**
   * Retrieves the context size of the model.
   * An override's `contextSize` takes precedence; otherwise reads
   * `meta.n_ctx` from the llama-swap `/v1/models` response,
   * falling back to `FALLBACK_CTX`.
   *
   * @returns The context size
   */
  protected override async getContextSize(): Promise<number> {
    const overridden = this.server.findOverrideForModel(this.id)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    const { data } = await this.server.fetchModels();
    const model = data.find((m) => m.id === this.id);

    return model?.meta?.n_ctx ?? FALLBACK_CTX;
  }

  /**
   * Detects the capabilities of the model.
   * An override's `capabilities` fully replaces detection.
   *
   * @returns An array of capabilities, as expected by Pi
   */
  override async getCapabilities(): Promise<("text" | "image")[]> {
    const overridden = this.server.findOverrideForModel(this.id)?.capabilities;
    if (overridden) return overridden;

    const { data } = await this.server.fetchModels();
    const model = data.find((m) => m.id === this.id);

    const inputModalities = model?.architecture?.input_modalities ?? [];
    return inputModalities.includes("image") ? ["text", "image"] : ["text"];
  }

  /**
   * Detects the load status of a model.
   * For simplicity, we'll only handle loaded/unloaded
   *
   * @returns The current {@link Status}
   */
  override async getStatus(): Promise<Status> {
    const { data } = await this.server.fetchModels();
    const model = data.find((m) => m.id === this.id);

    return model?.status?.value === "loaded" ? Status.LOADED : Status.UNLOADED;
  }

  /**
   * Loads the model in the llama-swap server
   */
  override async load(): Promise<void> {
    const status = await this.getStatus();
    if (status === Status.LOADED) return;

    try {
      await this.server.llamaSwapLoad(this.id);
    } catch (err) {
      console.warn({ err });
      throw new Error(`Model loading failed: ${this.id}`);
    }
  }

  /**
   * Unloads the model in the llama-swap server
   */
  override async unload(): Promise<void> {
    await this.server.llamaSwapUnload(this.id);
  }
}
