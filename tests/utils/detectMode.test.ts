import { describe, expect, it } from "vitest";
import { Mode } from "../../src/enums/mode";
import type { ModelsEndpoint } from "../../src/interfaces/endpoints/models";
import type { LlamaSwapPropsError } from "../../src/interfaces/endpoints/props";
import { detectMode } from "../../src/utils/detectMode";

const routerProps = {
  role: "router",
  default_generation_settings: {},
  total_slots: 2,
  model_alias: "",
  model_path: "",
  modalities: { vision: false, audio: false },
  media_marker: "",
  endpoint_slots: false,
  endpoint_props: false,
  endpoint_metrics: false,
  webui: false,
  webui_settings: {},
  chat_template: "",
  chat_template_caps: {},
  bos_token: "",
  eos_token: "",
  build_info: "",
  is_sleeping: false,
} as any;

const llamaSwapProps = {
  src: "llama-swap",
  error: {
    message: "no model id could be identified",
    type: "invalid_request_error",
    param: null,
    code: "not_found",
  },
} as any as LlamaSwapPropsError;

const singleProps = { ...routerProps, role: undefined } as any;

const data = (first: Record<string, unknown>): ModelsEndpoint["data"] =>
  [first as any] as ModelsEndpoint["data"];

describe("detectMode", () => {
  it("should detect LLAMASWAP when /props carries the llama-swap discriminator", () => {
    expect(detectMode(llamaSwapProps, data({ id: "m" }))).toBe(Mode.LLAMASWAP);
  });

  it("should detect ROUTER when /props reports a router role", () => {
    expect(detectMode(routerProps, data({ id: "m" }))).toBe(Mode.ROUTER);
  });

  it("should detect LEGACY when the first model carries max_model_len", () => {
    expect(
      detectMode(singleProps, data({ id: "m", max_model_len: 4096 })),
    ).toBe(Mode.LEGACY);
  });

  it("should fall back to SINGLE otherwise", () => {
    expect(detectMode(singleProps, data({ id: "m" }))).toBe(Mode.SINGLE);
  });
});
