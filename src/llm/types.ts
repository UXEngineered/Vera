// ─── Provider interface ──────────────────────────────────────────────────────
//
// The only surface the pipeline uses to talk to a model. Swap providers by
// config; nothing above this layer knows which vendor is behind it.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called with each text delta as it streams. */
  onText?: (delta: string) => void;
}

export interface CompletionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** "end_turn", "max_tokens", ... normalised by the provider. */
  stopReason: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
