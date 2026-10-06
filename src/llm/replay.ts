import { ProviderError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types.ts";

/**
 * Plays back recorded model outputs, one per call, streaming them in chunks.
 * Used by tests, by `bun run eval --replay`, and by the public demo when no
 * API key is configured (the UI labels these runs as recorded).
 */
export class ReplayProvider implements LlmProvider {
  readonly name = "replay";
  private next = 0;

  constructor(
    private outputs: string[],
    readonly model = "replay",
    private chunkDelayMs = 0,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = this.outputs[this.next++];
    if (text === undefined) throw new ProviderError("replay has no more recorded outputs", false);
    const started = performance.now();
    if (req.onText) {
      for (let i = 0; i < text.length; i += 48) {
        if (req.signal?.aborted) throw new ProviderError("model call cancelled", false);
        req.onText(text.slice(i, i + 48));
        if (this.chunkDelayMs) await Bun.sleep(this.chunkDelayMs);
      }
    }
    return {
      text,
      model: this.model,
      inputTokens: Math.ceil((req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4),
      outputTokens: Math.ceil(text.length / 4),
      stopReason: "end_turn",
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
