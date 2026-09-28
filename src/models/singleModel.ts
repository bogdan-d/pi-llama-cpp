import { Mode } from "../enums/mode";
import { BaseModel } from "./baseModel";

export class SingleModel extends BaseModel {
  override get mode(): Mode {
    return Mode.SINGLE;
  }

  protected override async getCapabilities(): Promise<("text" | "image")[]> {
    try {
      return await super.getCapabilities();
    } catch {
      // This is required when auth is wrong
      const { models } = await this.server.fetchModels();
      const [{ capabilities }] = models!;

      const hasImage = capabilities.includes("multimodal");
      return hasImage ? ["text", "image"] : ["text"];
    }
  }
}
