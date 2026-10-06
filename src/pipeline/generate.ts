import { randomUUID } from "node:crypto";
import { checkDeliverable, formatCheckIssues, type CheckIssue } from "../deliverables/check.ts";
import { buildPrompt } from "../deliverables/prompt.ts";
import type { Deliverable } from "../deliverables/schema.ts";
import type { DeliverableSpec } from "../deliverables/specs.ts";
import type { EvidenceLog } from "../evidence/schema.ts";
import { profileEvidence, type EvidenceProfile } from "../evidence/validate.ts";
import { tracedComplete, type ChatTurn, type LlmConfig, type LlmProvider, type TraceSink } from "../llm/index.ts";
import { completedArrayItems } from "./partial.ts";

export type PipelineEvent =
  | {
      type: "start";
      run_id: string;
      deliverable: string;
      provider: string;
      model: string;
      prompt_versions: string[];
      profile: EvidenceProfile;
    }
  | { type: "attempt"; attempt: number; max_attempts: number }
  /** A section that has finished streaming but has NOT been checked yet. */
  | { type: "draft_section"; attempt: number; section: unknown }
  | { type: "retry"; attempt: number; issues: CheckIssue[] }
  | { type: "done"; deliverable: Deliverable; attempts: number; usage: Usage }
  | { type: "failed"; message: string; issues: CheckIssue[]; attempts: number; usage: Usage };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface GenerateOptions {
  log: EvidenceLog;
  spec: DeliverableSpec;
  provider: LlmProvider;
  config: Pick<LlmConfig, "max_tokens" | "timeout_ms" | "max_retries">;
  trace: TraceSink;
  onEvent?: (event: PipelineEvent) => void;
  signal?: AbortSignal;
}

export type GenerateResult =
  | { ok: true; deliverable: Deliverable; attempts: number; usage: Usage; run_id: string }
  | { ok: false; message: string; issues: CheckIssue[]; deliverable?: Deliverable; attempts: number; usage: Usage; run_id: string };

/**
 * Evidence log → prompt → model → output checks → (retry with the failures) → checked deliverable.
 * Nothing reaches the caller as "done" unless it has passed every check.
 */
export async function generateDeliverable(opts: GenerateOptions): Promise<GenerateResult> {
  const { log, spec, provider, config, trace } = opts;
  const emit = opts.onEvent ?? (() => {});
  const runId = randomUUID();
  const profile = profileEvidence(log);
  const prompt = buildPrompt(spec, log, profile);
  const maxAttempts = config.max_retries + 1;
  const usage: Usage = { input_tokens: 0, output_tokens: 0, latency_ms: 0 };

  emit({
    type: "start",
    run_id: runId,
    deliverable: spec.id,
    provider: provider.name,
    model: provider.model,
    prompt_versions: prompt.versions,
    profile,
  });

  const messages: ChatTurn[] = [{ role: "user", content: prompt.user }];
  let lastIssues: CheckIssue[] = [];
  let lastDeliverable: Deliverable | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ type: "attempt", attempt, max_attempts: maxAttempts });

    let buffer = "";
    let emittedSections = 0;
    const result = await tracedComplete(
      provider,
      {
        system: prompt.system,
        messages,
        maxTokens: config.max_tokens,
        timeoutMs: config.timeout_ms,
        signal: opts.signal,
        onText: (delta) => {
          buffer += delta;
          const sections = completedArrayItems(buffer, "sections");
          while (emittedSections < sections.length) {
            emit({ type: "draft_section", attempt, section: sections[emittedSections++] });
          }
        },
      },
      { runId, attempt, promptVersions: prompt.versions },
      trace,
    );
    usage.input_tokens += result.inputTokens;
    usage.output_tokens += result.outputTokens;
    usage.latency_ms += result.latencyMs;

    const check = checkDeliverable(result.text, log, profile, spec);
    if (result.stopReason === "max_tokens") {
      check.issues.unshift({ check: "schema", path: "(root)", message: "output was cut off at the token limit; be more concise" });
      check.ok = false;
    }
    if (check.ok && check.deliverable) {
      emit({ type: "done", deliverable: check.deliverable, attempts: attempt, usage });
      return { ok: true, deliverable: check.deliverable, attempts: attempt, usage, run_id: runId };
    }

    lastIssues = check.issues;
    lastDeliverable = check.deliverable;
    if (attempt < maxAttempts) {
      emit({ type: "retry", attempt, issues: check.issues });
      messages.push(
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your output failed these checks:\n${formatCheckIssues(check.issues)}\n\nReturn the complete corrected JSON object. Fix every issue listed; keep everything else.`,
        },
      );
    }
  }

  const message = `output failed checks after ${maxAttempts} attempt(s)`;
  emit({ type: "failed", message, issues: lastIssues, attempts: maxAttempts, usage });
  return { ok: false, message, issues: lastIssues, deliverable: lastDeliverable, attempts: maxAttempts, usage, run_id: runId };
}
