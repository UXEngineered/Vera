import { AnthropicProvider } from "./anthropic.ts";
import type { LlmConfig } from "./config.ts";
import { ProviderError, type LlmProvider } from "./types.ts";

export * from "./types.ts";
export { loadLlmConfig, type LlmConfig } from "./config.ts";
export { ReplayProvider } from "./replay.ts";
export { createTraceSink, tracedComplete, type TraceSink, type TraceRecord } from "./trace.ts";

/** Build the configured provider. Replay providers are constructed directly with their recordings. */
export function createProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.model, config.effort);
    case "replay":
      throw new ProviderError("replay provider needs recordings; construct ReplayProvider directly", false);
  }
}
