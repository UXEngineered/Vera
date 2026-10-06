#!/usr/bin/env bun
/**
 * VERA eval suite.
 *
 *   bun run eval             live if ANTHROPIC_API_KEY is set, otherwise replay recordings
 *   bun run eval --live      call the configured model
 *   bun run eval --record    call the model and save its raw outputs to evals/recordings/
 *   bun run eval --replay    re-score saved recordings (no API calls, deterministic)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DELIVERABLES, type DeliverableId } from "../src/deliverables/specs.ts";
import { buildPrompt } from "../src/deliverables/prompt.ts";
import { parseEvidenceLog, profileEvidence } from "../src/evidence/validate.ts";
import { createProvider, createTraceSink, loadLlmConfig, ReplayProvider, type LlmProvider } from "../src/llm/index.ts";
import { generateDeliverable } from "../src/pipeline/generate.ts";
import { CASES, type LogName, type RunKey, type RunOutcome } from "./cases.ts";

const args = new Set(process.argv.slice(2));
const record = args.has("--record");
const mode: "live" | "replay" =
  args.has("--replay") ? "replay" : args.has("--live") || record ? "live" : process.env.ANTHROPIC_API_KEY ? "live" : "replay";

const config = loadLlmConfig();
const trace = createTraceSink(config);
const RUNS: RunKey[] = [...new Set(CASES.flatMap((c) => c.runs))];
const recordingPath = (key: RunKey) => `evals/recordings/${key}.json`;

interface Recording {
  model: string;
  recorded_at: string;
  prompt_sha: string;
  outputs: string[];
}

function loadLog(name: LogName) {
  const r = parseEvidenceLog(readFileSync(`examples/logs/${name}.json`, "utf-8"));
  if (!r.ok) throw new Error(`sample log ${name} is invalid`);
  return r.log;
}

/** Wraps a provider to keep every raw output, for --record. */
class Recorder implements LlmProvider {
  outputs: string[] = [];
  constructor(private inner: LlmProvider) {}
  get name() { return this.inner.name; }
  get model() { return this.inner.model; }
  async complete(req: Parameters<LlmProvider["complete"]>[0]) {
    const result = await this.inner.complete(req);
    this.outputs.push(result.text);
    return result;
  }
}

const staleRecordings: RunKey[] = [];

async function runOne(key: RunKey) {
  const [logName, deliverable] = key.split(".") as [LogName, DeliverableId];
  const log = loadLog(logName);
  const spec = DELIVERABLES[deliverable];
  const profile = profileEvidence(log);
  const p = buildPrompt(spec, log, profile);
  const promptSha = createHash("sha256").update(p.system + p.user).digest("hex").slice(0, 12);

  let provider: LlmProvider;
  let recording: Recording | undefined;
  if (mode === "replay") {
    if (!existsSync(recordingPath(key))) {
      return { outcome: { key, log, profile, ok: false, attempts: 0, issues: [], error: "no recording; run `bun run eval --record`" } as RunOutcome, usage: null };
    }
    recording = JSON.parse(readFileSync(recordingPath(key), "utf-8")) as Recording;
    if (recording.prompt_sha !== promptSha) staleRecordings.push(key);
    provider = new ReplayProvider(recording.outputs, recording.model);
  } else {
    provider = createProvider(config);
  }
  const recorder = new Recorder(provider);

  const started = performance.now();
  try {
    const result = await generateDeliverable({ log, spec, provider: recorder, config, trace });
    if (record) {
      const rec: Recording = { model: provider.model, recorded_at: new Date().toISOString(), prompt_sha: promptSha, outputs: recorder.outputs };
      writeFileSync(recordingPath(key), JSON.stringify(rec, null, 2) + "\n");
    }
    const outcome: RunOutcome = {
      key, log, profile,
      ok: result.ok,
      attempts: result.attempts,
      deliverable: result.deliverable,
      issues: result.ok ? [] : result.issues,
      error: result.ok ? undefined : result.message,
    };
    return { outcome, usage: { ...result.usage, wall_ms: Math.round(performance.now() - started) } };
  } catch (err) {
    return { outcome: { key, log, profile, ok: false, attempts: 0, issues: [], error: (err as Error).message } as RunOutcome, usage: null };
  }
}

if (mode === "replay" && !RUNS.some((k) => existsSync(recordingPath(k)))) {
  console.error("No ANTHROPIC_API_KEY and no recordings in evals/recordings/.");
  console.error("Set ANTHROPIC_API_KEY and run `bun run eval --record` to record a live run.");
  process.exit(2);
}

const model = mode === "replay" ? "recorded" : `${config.provider}/${config.model}`;
console.log(`\nVERA evals · mode: ${mode}${record ? " (recording)" : ""} · model: ${model}\n`);

const results = await Promise.all(RUNS.map(runOne));
const outcomes = new Map(results.map((r) => [r.outcome.key, r.outcome]));

// ── Score cases
const scored = CASES.map((c) => {
  const failures: string[] = [];
  for (const key of c.runs) {
    try {
      failures.push(...c.assert(outcomes.get(key)!).map((f) => `${key}: ${f}`));
    } catch (err) {
      failures.push(`${key}: ${(err as Error).message}`);
    }
  }
  return { id: c.id, category: c.category, description: c.description, pass: failures.length === 0, failures };
});

// ── Report
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
for (const s of scored) {
  console.log(`${s.pass ? "✓ PASS" : "✗ FAIL"}  ${pad(s.id, 34)} ${s.description}`);
  for (const f of s.failures.slice(0, 5)) console.log(`         ${f}`);
  if (s.failures.length > 5) console.log(`         … and ${s.failures.length - 5} more`);
}

const passed = scored.filter((s) => s.pass).length;
const byCategory = Object.fromEntries(
  [...new Set(scored.map((s) => s.category))].map((cat) => {
    const inCat = scored.filter((s) => s.category === cat);
    return [cat, `${inCat.filter((s) => s.pass).length}/${inCat.length}`];
  }),
);
const firstTry = results.filter((r) => r.outcome.ok && r.outcome.attempts === 1).length;
const tokens = results.reduce((n, r) => n + (r.usage ? r.usage.input_tokens + r.usage.output_tokens : 0), 0);

console.log(`\n${passed}/${scored.length} cases passed  ·  ${Object.entries(byCategory).map(([k, v]) => `${k} ${v}`).join("  ·  ")}`);
console.log(`runs passing checks on first attempt: ${firstTry}/${RUNS.length}${mode === "live" ? `  ·  tokens: ${tokens}` : ""}`);
for (const r of results) {
  const o = r.outcome;
  console.log(`  ${pad(o.key, 16)} ${o.ok ? "ok" : "FAILED"} in ${o.attempts} attempt(s)${r.usage && mode === "live" ? `, ${(r.usage.wall_ms / 1000).toFixed(1)}s` : ""}`);
}
if (staleRecordings.length) {
  console.log(`\n⚠ recordings made with an older prompt: ${staleRecordings.join(", ")}. Re-record with --record.`);
}

mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/latest.json",
  JSON.stringify(
    {
      ran_at: new Date().toISOString(),
      mode,
      model,
      passed,
      total: scored.length,
      by_category: byCategory,
      first_attempt_pass: `${firstTry}/${RUNS.length}`,
      runs: results.map((r) => ({ key: r.outcome.key, ok: r.outcome.ok, attempts: r.outcome.attempts, usage: r.usage })),
      cases: scored,
    },
    null,
    2,
  ) + "\n",
);
process.exitCode = passed === scored.length ? 0 : 1;
