import { describe, expect, it } from "vitest";
import { Mode } from "../../src/enums/mode";
import type {
  DataProperty,
  ModelsEndpoint,
} from "../../src/interfaces/endpoints/models";
import type {
  LlamaSwapPropsError,
  PropsEndpoint,
} from "../../src/interfaces/endpoints/props";
import { detectMode } from "../../src/utils/detectMode";

const routerProps: PropsEndpoint = {
  role: "router",
  max_instances: 2,
  models_autoload: false,
  model_alias: "",
  model_path: "",
  default_generation_settings: {},
  ui_settings: {},
  build_info: "",
  cors_proxy_enabled: false,
};

const llamaSwapProps: LlamaSwapPropsError = {
  src: "llama-swap",
  error: {
    message: "no model id could be identified",
    type: "invalid_request_error",
    param: null,
    code: "not_found",
  },
};

const singleProps = {
  ...routerProps,
  role: undefined,
} as Partial<PropsEndpoint>;

const data = (first: Partial<DataProperty>): ModelsEndpoint["data"] => [
  first as DataProperty,
];

describe("detectMode", () => {
  it("should detect LLAMASWAP when /props carries the llama-swap discriminator", () => {
    expect(detectMode(llamaSwapProps, data({ id: "m" }))).toBe(Mode.LLAMASWAP);
  });

  it("should detect ROUTER when /props reports a router role", () => {
    expect(detectMode(routerProps, data({ id: "m" }))).toBe(Mode.ROUTER);
  });

  it("should detect LEGACY when the first model carries max_model_len", () => {
    expect(
      detectMode(
        singleProps as PropsEndpoint | LlamaSwapPropsError,
        data({ id: "m", max_model_len: 4096 } as Record<string, unknown>),
      ),
    ).toBe(Mode.LEGACY);
  });

  it("should fall back to SINGLE otherwise", () => {
    expect(
      detectMode(
        singleProps as PropsEndpoint | LlamaSwapPropsError,
        data({ id: "m" }),
      ),
    ).toBe(Mode.SINGLE);
  });
});
