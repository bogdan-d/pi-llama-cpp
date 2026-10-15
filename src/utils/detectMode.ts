import { Mode } from "../enums/mode";
import type { DataProperty } from "../interfaces/endpoints/models";
import type {
  LlamaSwapPropsError,
  PropsEndpoint,
} from "../interfaces/endpoints/props";

/**
 * Detects the mode of a llama.cpp server from already-fetched endpoint
 * data — no second /v1/models round-trip.
 *
 * Detection order:
 * - `/props` with a `src: "llama-swap"` discriminator → LLAMASWAP
 * - `/props` with `role: "router"` → ROUTER
 * - Legacy `max_model_len` field on the first model → LEGACY
 * - Everything else → SINGLE
 *
 * @param serverProps Server properties fetched from `/props?autoload=false`
 * @param data Models endpoint data (from the same fetch round)
 * @returns The detected mode
 */
export function detectMode(
  serverProps: PropsEndpoint | LlamaSwapPropsError,
  data: DataProperty[],
): Mode {
  if ("src" in serverProps && serverProps.src === "llama-swap")
    return Mode.LLAMASWAP;
  if ("role" in serverProps && serverProps.role === "router")
    return Mode.ROUTER;
  if ("max_model_len" in data[0]) return Mode.LEGACY;
  return Mode.SINGLE;
}
