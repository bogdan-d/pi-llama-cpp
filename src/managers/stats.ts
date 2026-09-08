import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

/** Coerce a value to a finite number, or undefined. */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Narrow an unknown into a plain record. */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

// ─── Debug logging (opt-in) ─────────────────────────────────────────────────
// Enable with PI_LLAMA_STATS_DEBUG=1; output goes to
// PI_LLAMA_STATS_DEBUG_FILE (default /tmp/pi-llama-cpp-stats-debug.log).
const STATS_DEBUG = process.env.PI_LLAMA_STATS_DEBUG === "1";
const STATS_DEBUG_FILE =
  process.env.PI_LLAMA_STATS_DEBUG_FILE || "/tmp/pi-llama-cpp-stats-debug.log";

let streamSeq = 0;
let fetchSeq = 0;

function dbg(msg: string): void {
  if (!STATS_DEBUG) return;
  try {
    appendFileSync(STATS_DEBUG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // ignore logging failures
  }
}

/** Compact, content-safe summary of one SSE data chunk for the debug log. */
function summarizeChunk(chunk: Record<string, unknown>): string {
  const parts: string[] = [`keys=[${Object.keys(chunk).join(",")}]`];
  if (isObj(chunk.prompt_progress)) {
    parts.push(`prompt_progress=${JSON.stringify(chunk.prompt_progress)}`);
  }
  const choices = Array.isArray(chunk.choices) ? chunk.choices : undefined;
  if (choices) {
    if (choices.length === 0) {
      parts.push("choices=[]");
    } else {
      const c = isObj(choices[0]) ? choices[0] : undefined;
      const d = c && isObj(c.delta) ? c.delta : undefined;
      const dkeys: string[] = [];
      let contentLen = 0;
      let reasoningLen = 0;
      if (typeof d?.content === "string") {
        dkeys.push("content");
        contentLen = d.content.length;
      }
      if (typeof d?.reasoning_content === "string") {
        dkeys.push("reasoning_content");
        reasoningLen = d.reasoning_content.length;
      }
      if (typeof d?.reasoning === "string") dkeys.push("reasoning");
      parts.push(
        `choice{finish=${String(c?.finish_reason ?? "")},deltaKeys=[${dkeys.join(",")}],contentLen=${contentLen},reasoningLen=${reasoningLen}}`,
      );
    }
  }
  if (isObj(chunk.timings)) parts.push(`timings=${JSON.stringify(chunk.timings)}`);
  if (isObj(chunk.usage)) parts.push(`usage=${JSON.stringify(chunk.usage)}`);
  return parts.join(" ");
}

/**
 * Streaming phase of a single chat-completion request.
 *
 * - `idle`        — no progress/token event seen yet (Pi's default message shows).
 * - `prefilling`  — ingesting the prompt context (prompt_processing / prefill).
 * - `generating`  — the model is producing output tokens (token generation).
 * - `done`        — the stream finished; show the final summary.
 *
 * Prefilling and generating never overlap: they replace each other in the
 * single "working" message shown during streaming.
 */
type Phase = "idle" | "prefilling" | "generating" | "done";

/** Prompt-progress (prefill) payload from llama.cpp's `prompt_progress` field. */
interface PromptProgress {
  total?: number;
  processed?: number;
  time_ms?: number;
}

/** Authoritative per-phase final stats merged from `timings` / `usage`. */
interface FinalStat {
  n: number;
  ms: number;
  perSec?: number;
  /** Prompt tokens served from the prompt cache (prefill only). */
  cached?: number;
}

/**
 * Token-generation state for the live phase.
 *
 * `count` / `genStartMs` back the live tok/s estimate; the authoritative
 * numbers (prefill + generation) arrive later in `finalStats`.
 */
interface TgState {
  count: number;
  genStartMs: number;
}

/** Authoritative final stats for both phases, captured from the trailing event. */
interface FinalStats {
  prompt: FinalStat | null;
  generation: FinalStat | null;
}

/**
 * Shows prompt-processing and token-generation progress from llama.cpp's SSE
 * stream.
 *
 * Intercepts fetch requests to the configured llama.cpp server(s), captures
 * prompt_progress (prefill) plus timings/usage (generation) from the SSE
 * stream, and replaces the "Working..." text with live stats:
 *
 *   prefilling  → progress bar + ETA
 *   generating  → live tok/s of the produced output
 *   done        → final summary (working message) + stats widget above editor
 *
 * Self-contained: receives the resolved server base URLs so it knows precisely
 * which requests belong to llama.cpp (no auto-detection).
 */
export class StatsManager {
  /** Loaded-once guard key on globalThis. */
  private static readonly LOADED_KEY = "pi-llama-cpp/stats-loaded";

  /** Widget slot key for the final-stats line shown above the editor. */
  private static readonly WIDGET_KEY = "llama-cpp-stats";

  /** Max instantaneous-TPS samples kept for rate-curve fitting. */
  private static readonly MAX_RATE_POINTS = 20;

  /** Minimum gap between UI updates, to avoid thrashing the renderer. */
  private static readonly UI_THROTTLE_MS = 120;

  /** Width of the sliding window (ms) used for live generation tok/s. */
  private static readonly TG_WINDOW_MS = 3000;

  /** Floor on the window span (ms) to avoid rate spikes on tight token bursts. */
  private static readonly TG_MIN_SPAN_MS = 500;

  /** Cap on stored token-timestamp samples (bounds memory on long runs). */
  private static readonly TG_MAX_SAMPLES = 256;

  private phase: Phase = "idle";
  private pp: PromptProgress | null = null;
  private tg: TgState = { count: 0, genStartMs: 0 };

  /** Authoritative final stats for the most recent request. */
  private finalStats: FinalStats | null = null;

  private prevProcessed = 0;
  private prevTimeMs = 0;

  /** Instantaneous TPS measurements paired with processed depth for curve fitting. */
  private readonly rateHistory: { processed: number; tps: number }[] = [];

  /** Arrival timestamps of recently generated tokens, for live tok/s. */
  private tokenTimes: number[] = [];

  private lastUiUpdateMs = 0;
  /** Correlation id of the stream currently being parsed (debug only). */
  private currentStreamId = 0;
  private uiRef: ExtensionUIContext | null = null;
  private hasUIRef = false;
  private originalFetch: typeof fetch | null = null;

  constructor(private readonly getUrls: () => readonly string[]) {}

  /**
   * Wires up fetch interception and UI lifecycle events.
   * Idempotent via a global guard to avoid double-wrapping `globalThis.fetch`.
   *
   * @param pi The Pi extension API
   */
  initialize(pi: ExtensionAPI): void {
    dbg("initialize");
    const globalState = globalThis as Record<PropertyKey, unknown>;
    if (globalState[StatsManager.LOADED_KEY]) return;
    globalState[StatsManager.LOADED_KEY] = true;
    dbg("initialize: first load, wrapping fetch");

    this.originalFetch = globalThis.fetch;
    globalThis.fetch = this.interceptedFetch;

    pi.on("before_agent_start", (_event, ctx: ExtensionContext) => {
      dbg(`event before_agent_start hasUI=${ctx.hasUI}`);
      this.uiRef = ctx.ui;
      this.hasUIRef = ctx.hasUI;
      // New user turn: resetState() drops the previous turn's widget + state.
      this.resetState();
    });

    pi.on("turn_end", async (_event, ctx: ExtensionContext) => {
      dbg("event turn_end");
      if (ctx.hasUI) {
        ctx.ui.setWorkingMessage();
      }
    });

    pi.on("session_shutdown", async () => {
      dbg("event session_shutdown");
      // resetState() clears the widget while uiRef is still set.
      this.resetState();
      this.uiRef = null;
      this.hasUIRef = false;
      if (this.originalFetch) {
        globalThis.fetch = this.originalFetch;
        this.originalFetch = null;
      }
      delete globalState[StatsManager.LOADED_KEY];
    });
  }

  // ─── State management ──────────────────────────────────────────────────────

  /** Reset all per-request tracking state. */
  private resetState(): void {
    // A new request/turn starts: clear any prior final-stats widget so a
    // finished round's stats aren't shown while the next round streams.
    this.clearFinalWidget();
    this.phase = "idle";
    this.pp = null;
    this.tg = { count: 0, genStartMs: 0 };
    this.finalStats = null;
    this.prevProcessed = 0;
    this.prevTimeMs = 0;
    this.rateHistory.length = 0;
    this.tokenTimes.length = 0;
    this.lastUiUpdateMs = 0;
  }

  /** Transition into the generation phase, starting the token timer fresh. */
  private enterGenerating(): void {
    this.phase = "generating";
    this.tg = { count: 0, genStartMs: Date.now() };
    this.tokenTimes.length = 0;
  }

  // ─── Formatting ────────────────────────────────────────────────────────────

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

  private formatTokensPerSec(processed: number, timeMs: number): string {
    const secs = timeMs / 1000;
    if (secs <= 0) return "";
    const rate = processed / secs;
    return `${rate.toFixed(1)} tok/s`;
  }

  /** Prefill bar with ETA, fed by `prompt_progress` events. */
  private formatPrefillMessage(): string {
    const pp = this.pp;
    if (!pp?.total || pp.processed === undefined) return "Prefilling...";

    const pct = (pp.processed / pp.total) * 100;
    const filled = Math.round((pct / 100) * 20);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);

    let suffix = "";
    const processed = pp.processed;
    const total = pp.total;
    const timeMs = pp.time_ms;
    if (timeMs && processed > 0) {
      const elapsedSec = timeMs / 1000;
      const avgRate = processed / elapsedSec;
      const remaining = total - processed;
      let etaSec = remaining / avgRate;

      // Use delta from last update for instantaneous TPS
      const deltaProcessed = processed - this.prevProcessed;
      const deltaTimeMs = timeMs - this.prevTimeMs;
      const tps =
        deltaTimeMs > 0 && deltaProcessed > 0
          ? this.formatTokensPerSec(deltaProcessed, deltaTimeMs)
          : this.formatTokensPerSec(processed, timeMs);

      // Predict ETA using rate curve model (overrides cumulative estimate)
      const predictedEta = this.estimateEtaSec(processed, total);
      if (predictedEta > 0) etaSec = predictedEta;
      suffix = `${this.formatDuration(etaSec)} · ${tps}`;
    }

    return `Prefilling... ${bar} ${pct.toFixed(0).padStart(3)}%${suffix ? ` · ${suffix}` : suffix}`;
  }

  /** Live generation stats: token count, sliding-window tok/s, elapsed. */
  private formatGenMessage(): string {
    const count = this.tg.count;
    if (count === 0) return "Generating...";
    const elapsedSec = Math.max(0, (Date.now() - this.tg.genStartMs) / 1000);
    const tps = this.computeLiveTps();
    const tpsStr = tps !== null ? `${tps.toFixed(1)} tok/s · ` : "";
    return `Generating... ${count} tok · ${tpsStr}${this.formatDuration(elapsedSec)}`;
  }

  /** Format one phase's authoritative stats: "N tok · X tok/s · D". */
  private formatStatLine(s: FinalStat): string {
    const perSec = s.perSec ?? (s.ms > 0 ? s.n / (s.ms / 1000) : undefined);
    const parts: string[] = [`${s.n} tok`];
    if (perSec && perSec > 0) parts.push(`${perSec.toFixed(1)} tok/s`);
    if (s.ms > 0) parts.push(this.formatDuration(s.ms / 1000));
    return parts.join(" · ");
  }

  /** Final summary, preferring the server's authoritative timings when present. */
  private formatDoneMessage(): string {
    const g = this.finalStats?.generation;
    if (g && g.n > 0) {
      return `Done! ${this.formatStatLine(g)}`;
    }
    // No authoritative timings — fall back to the live window rate.
    const count = this.tg.count;
    if (count === 0) return "Done!";
    const tps = this.computeLiveTps();
    const tpsStr = tps !== null ? ` · ${tps.toFixed(1)} tok/s` : "";
    return `Done! ${count} tok${tpsStr}`;
  }

  /**
   * Lines for the final-stats widget shown above the editor after generation.
   * Reports both phases when the server provides the numbers.
   */
  private formatFinalWidgetLines(): string[] {
    const lines: string[] = [];
    const p = this.finalStats?.prompt;
    if (p && p.n > 0) {
      const cached = p.cached && p.cached > 0 ? ` · ${p.cached} cached` : "";
      lines.push(`Prefill   ${this.formatStatLine(p)}${cached}`);
    }

    const g = this.finalStats?.generation;
    if (g && g.n > 0) {
      lines.push(`Generate  ${this.formatStatLine(g)}`);
    } else if (this.tg.count > 0) {
      // No authoritative generation stats — use what we measured live.
      const tps = this.computeLiveTps();
      const tpsStr = tps !== null ? `${tps.toFixed(1)} tok/s · ` : "";
      const sec = Math.max(0, (Date.now() - this.tg.genStartMs) / 1000);
      lines.push(
        `Generate  ${this.tg.count} tok · ${tpsStr}${this.formatDuration(sec)}`,
      );
    }
    return lines;
  }

  /** Show the final-stats widget for the stream that just completed. */
  private showFinalWidget(): void {
    if (!this.uiRef || !this.hasUIRef) {
      dbg(`showFinalWidget skip (hasUIRef=${this.hasUIRef})`);
      return;
    }
    const lines = this.formatFinalWidgetLines();
    if (lines.length === 0) {
      dbg("showFinalWidget skip (no lines)");
      return;
    }
    if (STATS_DEBUG) {
      dbg(`ui setWidget ${StatsManager.WIDGET_KEY} ${JSON.stringify(lines)}`);
    }
    this.uiRef.setWidget(StatsManager.WIDGET_KEY, lines);
  }

  /** Remove the final-stats widget, if any. */
  private clearFinalWidget(): void {
    if (!this.uiRef || !this.hasUIRef) return;
    dbg(`ui setWidget ${StatsManager.WIDGET_KEY} undefined (clear)`);
    this.uiRef.setWidget(StatsManager.WIDGET_KEY, undefined);
  }

  private getProgressMessage(): string | null {
    switch (this.phase) {
      case "prefilling":
        return this.formatPrefillMessage();
      case "generating":
        return this.formatGenMessage();
      case "done":
        return this.formatDoneMessage();
      default:
        return null; // idle — leave Pi's default working message untouched
    }
  }

  // ─── Generation rate (sliding window) ─────────────────────────────────────

  /**
   * Record a generated token's arrival time for the sliding-window rate.
   * Called once per counted output token.
   */
  private recordToken(): void {
    const now = Date.now();
    this.tokenTimes.push(now);
    // Drop samples that fell out of the window (oldest are at the front).
    const cutoff = now - StatsManager.TG_WINDOW_MS;
    while (this.tokenTimes.length > 0 && this.tokenTimes[0] < cutoff) {
      this.tokenTimes.shift();
    }
    if (this.tokenTimes.length > StatsManager.TG_MAX_SAMPLES) {
      this.tokenTimes.splice(
        0,
        this.tokenTimes.length - StatsManager.TG_MAX_SAMPLES,
      );
    }
  }

  /**
   * Recent generation throughput, measured over the last few seconds of tokens.
   *
   * Unlike a cumulative `count / elapsed-since-start`, this ignores the
   * time-to-first-token and any idle stretches, so the displayed tok/s tracks
   * the true rate instead of decaying toward 0 over long generations where the
   * SSE stream bursts or pauses. Returns null until a span of samples exists.
   */
  private computeLiveTps(): number | null {
    const t = this.tokenTimes;
    if (t.length < 2) return null;
    const span = Math.max(t[t.length - 1] - t[0], StatsManager.TG_MIN_SPAN_MS);
    return (t.length - 1) / (span / 1000);
  }

  // ─── Rate-curve model (prefill ETA) ────────────────────────────────────────

  /** Linear regression: fit TPS = slope * processed + intercept */
  private fitRateCurve(): { slope: number; intercept: number } | null {
    const n = this.rateHistory.length;
    if (n < 2) return null;

    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    for (const pt of this.rateHistory) {
      sumX += pt.processed;
      sumY += pt.tps;
      sumXY += pt.processed * pt.tps;
      sumX2 += pt.processed * pt.processed;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  }

  /** Estimate remaining time using the rate curve model. */
  private estimateEtaSec(processed: number, total: number): number {
    const fit = this.fitRateCurve();
    if (!fit) return 0; // Not enough data — caller falls back to cumulative avg.

    const { slope, intercept } = fit;

    if (Math.abs(slope) < 0.001) {
      // Essentially flat — use average TPS
      const avgTps =
        this.rateHistory.reduce((s, p) => s + p.tps, 0) /
        this.rateHistory.length;
      return avgTps > 0 ? (total - processed) / avgTps : 0;
    }

    // TPS(x) = slope * x + intercept
    // dt/dx = 1 / (slope * x + intercept)
    // t = ∫ dx / (slope * x + intercept) from processed to total
    // t = (1/slope) * ln((slope*total + intercept) / (slope*processed + intercept))
    const a = slope * total + intercept;
    const b = slope * processed + intercept;

    if (a <= 0 || b <= 0) {
      // Model predicts negative TPS — fall back to average
      const avgTps =
        this.rateHistory.reduce((s, p) => s + p.tps, 0) /
        this.rateHistory.length;
      return avgTps > 0 ? (total - processed) / avgTps : 0;
    }

    const ratio = a / b;
    if (ratio <= 0) return 0;

    return Math.log(ratio) / slope;
  }

  // ─── UI updates ────────────────────────────────────────────────────────────

  private updateWorkingMessage(): void {
    if (!this.uiRef || !this.hasUIRef) return;
    const msg = this.getProgressMessage();
    if (msg === null) return; // idle — leave Pi's default working message
    if (STATS_DEBUG) {
      dbg(`ui setWorkingMessage stream#${this.currentStreamId} msg=${JSON.stringify(msg)}`);
    }
    this.uiRef.setWorkingMessage(msg);
  }

  /** Throttled UI refresh; `force` bypasses the throttle for transitions. */
  private maybeUpdateUi(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastUiUpdateMs < StatsManager.UI_THROTTLE_MS) return;
    this.lastUiUpdateMs = now;
    this.updateWorkingMessage();
  }

  // ─── SSE chunk handling ────────────────────────────────────────────────────

  /**
   * Capture authoritative final stats from a chunk carrying `timings` and/or
   * `usage`. llama.cpp typically sends these on the trailing usage event:
   *
   *   { timings: { predicted_n, predicted_ms, predicted_per_second, ... },
   *     usage:   { completion_tokens, completion_time_ms, ... } }
   *
   * Not all models/servers expose the `predicted_*` fields, so we merge
   * whichever source provides each value.
   */
  private captureFinal(chunk: Record<string, unknown>): void {
    const t = isObj(chunk.timings) ? chunk.timings : undefined;
    const u = isObj(chunk.usage) ? chunk.usage : undefined;
    const details =
      u && isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : undefined;

    const promptN = num(t?.prompt_n) ?? num(u?.prompt_tokens);
    const promptMs = num(t?.prompt_ms) ?? num(u?.prompt_time_ms);
    const promptPerSec = num(t?.prompt_per_second);
    // Tokens served from the prompt cache (not freshly evaluated). When this
    // is high, prompt_n is only the freshly-processed remainder.
    const cached = num(t?.cache_n) ?? num(details?.cached_tokens);

    const genN = num(t?.predicted_n) ?? num(u?.completion_tokens);
    const genMs = num(t?.predicted_ms) ?? num(u?.completion_time_ms);
    const genPerSec = num(t?.predicted_per_second);

    if (!this.finalStats) this.finalStats = { prompt: null, generation: null };
    if (promptN !== undefined) {
      this.finalStats.prompt = {
        n: promptN,
        ms: promptMs ?? 0,
        perSec: promptPerSec,
        cached,
      };
    }
    if (genN !== undefined) {
      this.finalStats.generation = { n: genN, ms: genMs ?? 0, perSec: genPerSec };
    }
  }

  /**
   * Update internal state from one parsed SSE data line.
   *
   * Order matters: prefill progress is processed first, then final timings,
   * then content tokens, then end-of-stream signals.
   */
  private handleChunk(chunk: Record<string, unknown>): void {
    let force = false;

    // 1) Prompt-processing progress (prefilling).
    if (isObj(chunk.prompt_progress)) {
      const p = chunk.prompt_progress as PromptProgress;
      this.prevProcessed = this.pp?.processed ?? 0;
      this.prevTimeMs = this.pp?.time_ms ?? 0;
      this.pp = p;
      if (this.phase !== "generating" && this.phase !== "done") {
        this.phase = "prefilling";
      }
      // Record instantaneous TPS for curve fitting
      const deltaP = (p.processed ?? 0) - this.prevProcessed;
      const deltaT = (p.time_ms ?? 0) - this.prevTimeMs;
      if (deltaT > 0 && deltaP > 0) {
        this.rateHistory.push({
          processed: p.processed ?? 0,
          tps: deltaP / (deltaT / 1000),
        });
        if (this.rateHistory.length > StatsManager.MAX_RATE_POINTS) {
          this.rateHistory.shift();
        }
      }
      // Prefill complete → bridge straight into generation (covers
      // time-to-first-token, where no content token has arrived yet).
      if (p.total && p.processed === p.total && this.phase === "prefilling") {
        this.enterGenerating();
      }
      force = true;
    }

    // 2) Authoritative final timings/usage (may ride on the trailing usage
    //    event or the last content chunk with finish_reason).
    if (isObj(chunk.timings) || isObj(chunk.usage)) {
      this.captureFinal(chunk);
      force = true;
    }

    // 3) Generated output tokens — start/continue the generation phase.
    //    Count visible text AND reasoning/thinking fields, so a long reasoning
    //    run still drives the live rate (otherwise its tokens would be missed
    //    and the displayed tok/s would decay toward 0).
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choiceObj = isObj(choices[0]) ? choices[0] : undefined;
    const delta = choiceObj && isObj(choiceObj.delta) ? choiceObj.delta : undefined;
    const deltaText =
      (typeof delta?.content === "string" && delta.content) ||
      (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
      (typeof delta?.reasoning === "string" && delta.reasoning) ||
      "";
    const hasOutput = deltaText.length > 0;
    const finishReason =
      typeof choiceObj?.finish_reason === "string" ? choiceObj.finish_reason : undefined;

    if (hasOutput) {
      if (this.phase !== "generating" && this.phase !== "done") {
        this.enterGenerating();
        force = true; // crisp switch from the prefill bar to generation
      }
      if (this.phase === "generating") {
        this.tg.count += 1;
        this.recordToken();
      }
    }

    // 4) End-of-stream signals: finish_reason, or an empty-choices usage event.
    const emptyChoices = choices.length === 0;
    if (finishReason || (emptyChoices && (isObj(chunk.timings) || isObj(chunk.usage)))) {
      if (this.phase !== "done") {
        this.phase = "done";
        force = true;
        if (STATS_DEBUG) {
          dbg(
            `stream#${this.currentStreamId} -> done (finishReason=${finishReason ?? ""} emptyChoices=${emptyChoices}) tg.count=${this.tg.count} finalStats=${JSON.stringify(this.finalStats)}`,
          );
        }
      }
    }

    if (force) {
      dbg(
        `stream#${this.currentStreamId} handle phase=${this.phase} count=${this.tg.count} force`,
      );
    }

    this.maybeUpdateUi(force);

    // Once finished, surface the final stats as a widget above the editor.
    if (this.phase === "done") {
      this.showFinalWidget();
    }
  }

  // ─── SSE Stream Interceptor ────────────────────────────────────────────────

  private captureTimings(
    body: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let buffer = "";
    const decoder = new TextDecoder();

    const sid = ++streamSeq;
    let chunkCount = 0;
    this.currentStreamId = sid;
    dbg(`stream#${sid} start`);
    return new ReadableStream({
      start: async (controller) => {
        // Fresh state for this request so leftover progress/phase from a
        // previous (or concurrent) request can't bleed through.
        this.resetState();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") {
              dbg(`stream#${sid} chunk [DONE]`);
              continue;
            }

            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              chunkCount += 1;
              this.currentStreamId = sid;
              if (STATS_DEBUG) {
                dbg(`stream#${sid} chunk#${chunkCount}: ${summarizeChunk(parsed)}`);
              }
              this.handleChunk(parsed);
            } catch {
              // Ignore parse errors
            }
          }

          controller.enqueue(value);
        }
        dbg(`stream#${sid} end totalChunks=${chunkCount} finalPhase=${this.phase}`);
        controller.close();
      },
      cancel: (reason?: unknown) => {
        void reader.cancel(reason);
      },
    });
  }

  // ─── Fetch Interception ────────────────────────────────────────────────────

  private isLlamaCppRequest(input: RequestInfo | URL): boolean {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (typeof url !== "string") return false;
    if (!url.includes("/chat/completions")) return false;

    return this.getUrls().some((baseUrl) => {
      const origin = baseUrl.replace(/\/+$/, "");
      return url === origin || url.startsWith(`${origin}/`);
    });
  }

  private ensureStreamOptions(init?: RequestInit): void {
    try {
      const body = init?.body;
      if (!body) return;

      const isString = typeof body === "string";
      const p = isString
        ? JSON.parse(body)
        : { ...(body as unknown as Record<string, unknown>) };

      if (!p.stream_options) {
        p.stream_options = { include_usage: true };
      } else if (!p.stream_options.include_usage) {
        p.stream_options.include_usage = true;
      }

      if (p.stream && !p.return_progress) {
        p.return_progress = true;
      }

      const newBody = JSON.stringify(p);
      if (isString) {
        init!.body = newBody;
      } else {
        Object.assign(body as object, p);
      }
    } catch {
      // Ignore parse errors
    }
  }

  private readonly interceptedFetch: typeof fetch = async (input, init) => {
    const fid = ++fetchSeq;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const llama = this.isLlamaCppRequest(input);
    dbg(`fetch#${fid} intercept llama=${llama} url=${url ?? "?"}`);
    if (!llama) {
      return this.originalFetch!(input, init);
    }

    this.ensureStreamOptions(init);

    const response = await this.originalFetch!(input, init);
    dbg(`fetch#${fid} response ok=${response.ok} hasBody=${!!response.body}`);

    if (response.ok && response.body) {
      return new Response(this.captureTimings(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    }
    return response;
  };
}
