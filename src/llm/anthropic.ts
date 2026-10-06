import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types.ts";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    readonly model: string,
    private effort: "low" | "medium" | "high",
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) throw new ProviderError("ANTHROPIC_API_KEY is not set", false);
    // Retries for transient API errors live in the SDK; schema retries live in the pipeline.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = performance.now();
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          output_config: { effort: this.effort },
        },
        { timeout: req.timeoutMs, signal: req.signal },
      );
      if (req.onText) stream.on("text", (delta) => req.onText!(delta));
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new ProviderError("the model declined this request", false);
      }
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        text,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        stopReason: message.stop_reason ?? "unknown",
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("model provider rate limit reached", true);
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("model provider rejected the API key", false);
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new ProviderError(`model call timed out after ${req.timeoutMs}ms`, true);
      }
      if (err instanceof Anthropic.APIUserAbortError) throw new ProviderError("model call cancelled", false);
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(`model provider error ${err.status ?? ""}: ${err.message}`, (err.status ?? 500) >= 500);
      }
      throw err;
    }
  }
}
