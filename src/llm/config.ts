import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";

// ─── Pipeline LLM config ─────────────────────────────────────────────────────
//
// Read from the "llm" block of vera.config.json, overridable by environment
// variables so a deploy can change model or limits without a code change.

export const LlmConfigSchema = z.object({
  provider: z.enum(["anthropic", "replay"]).default("anthropic"),
  model: z.string().default("claude-sonnet-5-5"),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  max_tokens: z.number().int().positive().default(16000),
  timeout_ms: z.number().int().positive().default(120_000),
  /** Retries after a schema/check failure. Total attempts = max_retries + 1. */
  max_retries: z.number().int().min(0).max(3).default(2),
  trace: z.enum(["file", "console", "off"]).default("file"),
  trace_dir: z.string().default("traces"),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

function readConfigFile(cwd: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, "vera.config.json"), "utf-8"));
    return (raw?.llm ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const ENV_OVERRIDES: [string, keyof LlmConfig, "string" | "number"][] = [
  ["VERA_PROVIDER", "provider", "string"],
  ["VERA_MODEL", "model", "string"],
  ["VERA_EFFORT", "effort", "string"],
  ["VERA_MAX_TOKENS", "max_tokens", "number"],
  ["VERA_TIMEOUT_MS", "timeout_ms", "number"],
  ["VERA_MAX_RETRIES", "max_retries", "number"],
  ["VERA_TRACE", "trace", "string"],
  ["VERA_TRACE_DIR", "trace_dir", "string"],
];

export function loadLlmConfig(cwd = process.cwd(), env = process.env): LlmConfig {
  const merged: Record<string, unknown> = { ...readConfigFile(cwd) };
  for (const [name, key, type] of ENV_OVERRIDES) {
    const value = env[name];
    if (value) merged[key] = type === "number" ? Number(value) : value;
  }
  return LlmConfigSchema.parse(merged);
}
