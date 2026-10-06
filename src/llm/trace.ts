import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LlmConfig } from "./config.ts";
import type { CompletionRequest, CompletionResult, LlmProvider } from "./types.ts";

export interface TraceRecord {
  ts: string;
  run_id: string;
  attempt: number;
  provider: string;
  model: string;
  prompt_versions: string[];
  input: { system: string; messages: CompletionRequest["messages"] };
  output: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  stop_reason: string | null;
  latency_ms: number;
}

export type TraceSink = (record: TraceRecord) => void;

export function createTraceSink(config: Pick<LlmConfig, "trace" | "trace_dir">): TraceSink {
  if (config.trace === "off") return () => {};
  if (config.trace === "console") {
    // Console traces skip the full prompt text to keep server logs readable.
    return (r) =>
      console.log(
        JSON.stringify({
          type: "llm_call",
          ...r,
          input: { system_chars: r.input.system.length, messages: r.input.messages.length },
          output: r.output ? `${r.output.length} chars` : null,
        }),
      );
  }
  mkdirSync(config.trace_dir, { recursive: true });
  return (r) => appendFileSync(join(config.trace_dir, `${r.ts.slice(0, 10)}.jsonl`), JSON.stringify(r) + "\n");
}

/** Call a provider and record the call (inputs, output, tokens, latency), success or failure. */
export async function tracedComplete(
  provider: LlmProvider,
  req: CompletionRequest,
  meta: { runId: string; attempt: number; promptVersions: string[] },
  sink: TraceSink,
): Promise<CompletionResult> {
  const started = performance.now();
  const base = {
    ts: new Date().toISOString(),
    run_id: meta.runId,
    attempt: meta.attempt,
    provider: provider.name,
    model: provider.model,
    prompt_versions: meta.promptVersions,
    input: { system: req.system, messages: req.messages },
  };
  try {
    const result = await provider.complete(req);
    sink({
      ...base,
      output: result.text,
      error: null,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      stop_reason: result.stopReason,
      latency_ms: result.latencyMs,
    });
    return result;
  } catch (err) {
    sink({
      ...base,
      output: null,
      error: (err as Error).message,
      input_tokens: null,
      output_tokens: null,
      stop_reason: null,
      latency_ms: Math.round(performance.now() - started),
    });
    throw err;
  }
}
