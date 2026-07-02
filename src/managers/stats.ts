import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Shows prompt-processing progress from llama.cpp's SSE stream.
 *
 * Intercepts fetch requests to the configured llama.cpp server(s), captures
 * timings / prompt_progress from the SSE stream, and replaces the "Working..."
 * text with a progress bar during prefilling.
 *
 * Self-contained: receives the resolved server base URLs so it knows precisely
 * which requests belong to llama.cpp (no auto-detection).
 */
export class StatsManager {
  /** Loaded-once guard key on globalThis. */
  private static readonly LOADED_KEY = "pi-llama-cpp/stats-loaded";

  /** Max instantaneous-TPS samples kept for rate-curve fitting. */
  private static readonly MAX_RATE_POINTS = 20;

  private currentProgress: {
    total?: number;
    processed?: number;
    time_ms?: number;
  } | null = null;
  private prevProcessed = 0;
  private prevTimeMs = 0;
  private hasReceivedPrefill = false;

  /** Instantaneous TPS measurements paired with processed depth for curve fitting. */
  private readonly rateHistory: { processed: number; tps: number }[] = [];

  private uiRef: ExtensionUIContext | null = null;
  private hasUIRef = false;
  private originalFetch: typeof fetch | null = null;

  constructor(private readonly urls: string[]) {}

  /**
   * Wires up fetch interception and UI lifecycle events.
   * Idempotent via a global guard to avoid double-wrapping `globalThis.fetch`.
   *
   * @param pi The Pi extension API
   */
  initialize(pi: ExtensionAPI): void {
    const globalState = globalThis as Record<PropertyKey, unknown>;
    if (globalState[StatsManager.LOADED_KEY]) return;
    globalState[StatsManager.LOADED_KEY] = true;

    this.originalFetch = globalThis.fetch;
    globalThis.fetch = this.interceptedFetch;

    pi.on("before_agent_start", (_event, ctx: ExtensionContext) => {
      this.uiRef = ctx.ui;
      this.hasUIRef = ctx.hasUI;
    });

    pi.on("turn_end", async (_event, ctx: ExtensionContext) => {
      if (ctx.hasUI) {
        ctx.ui.setWorkingMessage();
      }
    });

    pi.on("session_shutdown", async () => {
      this.uiRef = null;
      this.hasUIRef = false;
      this.rateHistory.length = 0;
      this.prevProcessed = 0;
      this.prevTimeMs = 0;
      if (this.originalFetch) {
        globalThis.fetch = this.originalFetch;
        this.originalFetch = null;
      }
      delete globalState[StatsManager.LOADED_KEY];
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

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

  private formatTokensPerSec(processed: number, timeMs: number): string {
    const secs = timeMs / 1000;
    if (secs <= 0) return "";
    const rate = processed / secs;
    return `${rate.toFixed(1)} tok/s`;
  }

  private getProgressMessage(): string | null {
    if (!this.hasReceivedPrefill) return null;
    if (
      !this.currentProgress?.total ||
      this.currentProgress.processed === undefined
    ) {
      return "Prefilling...";
    }

    const pct =
      (this.currentProgress.processed / this.currentProgress.total) * 100;
    const filled = Math.round((pct / 100) * 20);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);

    let suffix = "";
    const processed = this.currentProgress.processed;
    const total = this.currentProgress.total;
    const timeMs = this.currentProgress.time_ms;
    if (timeMs && processed > 0) {
      const elapsedSec = timeMs / 1000;
      const avgRate = processed / elapsedSec;
      const remaining = total - processed;
      let etaSec = remaining / avgRate;

      // Use delta from last update for instantaneous TPS
      const deltaProcessed = processed - this.prevProcessed;
      const deltaTimeMs = timeMs - this.prevTimeMs;
      let tps: string;
      if (deltaTimeMs > 0 && deltaProcessed > 0) {
        tps = this.formatTokensPerSec(deltaProcessed, deltaTimeMs);
      } else {
        tps = this.formatTokensPerSec(processed, timeMs);
      }

      // Predict ETA using rate curve model (overrides cumulative estimate)
      const predictedEta = this.estimateEtaSec(processed, total);
      if (predictedEta > 0) etaSec = predictedEta;
      suffix = `${this.formatDuration(etaSec)} · ${tps}`;
    }

    return `Prefilling... ${bar} ${pct.toFixed(0).padStart(3)}%${suffix ? ` · ${suffix}` : suffix}`;
  }

  private updateWorkingMessage(): void {
    if (!this.uiRef || !this.hasUIRef) return;
    const msg = this.getProgressMessage();
    if (msg === null) {
      // No prefill update received yet — don't show progress
      return;
    }
    // Restore message when prefilling hits 100%
    if (
      this.currentProgress?.total &&
      this.currentProgress.processed === this.currentProgress.total
    ) {
      this.uiRef.setWorkingMessage();
    } else {
      this.uiRef.setWorkingMessage(msg);
    }
  }

  // ─── SSE Stream Interceptor ────────────────────────────────────────────────

  private captureTimings(
    body: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let buffer = "";
    const decoder = new TextDecoder();

    return new ReadableStream({
      start: async (controller) => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") continue;

            try {
              const chunk = JSON.parse(jsonStr);
              if (chunk.prompt_progress) {
                const p = chunk.prompt_progress;
                // Save previous values for delta TPS calculation
                if (this.currentProgress) {
                  this.prevProcessed = this.currentProgress.processed ?? 0;
                  this.prevTimeMs = this.currentProgress.time_ms ?? 0;
                }
                this.currentProgress = p;
                this.hasReceivedPrefill = true;

                // Record instantaneous TPS for curve fitting
                const deltaP = (p.processed ?? 0) - this.prevProcessed;
                const deltaT = (p.time_ms ?? 0) - this.prevTimeMs;
                if (deltaT > 0 && deltaP > 0) {
                  const tps = deltaP / (deltaT / 1000);
                  this.rateHistory.push({ processed: p.processed ?? 0, tps });
                  if (this.rateHistory.length > StatsManager.MAX_RATE_POINTS) {
                    this.rateHistory.shift();
                  }
                }
              }
              this.updateWorkingMessage();
            } catch {
              // Ignore parse errors
            }
          }

          controller.enqueue(value);
        }
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

    return this.urls.some((baseUrl) => {
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
    if (!this.isLlamaCppRequest(input)) {
      return this.originalFetch!(input, init);
    }

    this.ensureStreamOptions(init);

    const response = await this.originalFetch!(input, init);

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
