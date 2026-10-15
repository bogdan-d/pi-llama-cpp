import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { BaseModel } from "./baseModel";

/**
 * Represents a model in llama-server router mode.
 * Tracks per-model status from the /models endpoint and extracts
 * context size from startup arguments when the model is not loaded.
 */
export class RouterModel extends BaseModel {
  get mode(): Mode {
    return Mode.ROUTER;
  }

  /**
   * Gets the context size of a particular model.
   * In router mode, falls back to parsing CLI args when the model is unloaded.
   *
   * @returns The context size in tokens
   */
  protected override async getContextSize(): Promise<number> {
    // We can get a more accurate context size if the model is already loaded
    if ((await this.getStatus()) === Status.LOADED) {
      return super.getContextSize();
    }

    const response =
      this.extractFrom("--ctx-size") ??
      this.extractFrom("--fit-ctx") ??
      FALLBACK_CTX;

    return response;
  }

  /**
   * Extracts the value from a llama-server argument
   * @param arg The argument
   * @returns The value
   */
  private extractFrom(arg: string): number | null {
    const args = this.model.status?.args;
    if (!args) return null;

    const ctxIdx = args.indexOf(arg);

    if (ctxIdx === -1) return null;
    if (args.length <= ctxIdx + 1) return null;

    const parsed = parseInt(args[ctxIdx + 1], 10);
    if (!isNaN(parsed)) return parsed;

    return null;
  }
}
