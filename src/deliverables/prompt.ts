import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRulesForPrompt } from "../confidence/rules.ts";
import type { EvidenceLog } from "../evidence/schema.ts";
import type { EvidenceProfile } from "../evidence/validate.ts";
import type { DeliverableSpec } from "./specs.ts";

export const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");
export const SYSTEM_PROMPT_FILE = "system.v1.md";

function readPrompt(file: string): string {
  return readFileSync(join(PROMPTS_DIR, file), "utf-8").trim();
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /** Prompt files used, for the trace log and eval reports. */
  versions: string[];
}

export function buildPrompt(spec: DeliverableSpec, log: EvidenceLog, profile: EvidenceProfile): BuiltPrompt {
  const sections = spec.sections.map((s) => `- \`${s.id}\` (${s.title}): ${s.purpose}`).join("\n");
  const system = readPrompt(SYSTEM_PROMPT_FILE)
    .replaceAll("{{DELIVERABLE_TITLE}}", spec.title.toLowerCase())
    .replace("{{CONFIDENCE_RULES}}", renderRulesForPrompt())
    .replace("{{ACTION_FIELD}}", spec.requiresAction ? `, "action": "build" | "validate" | "investigate"` : "")
    .replace("{{SECTIONS}}", sections)
    .replace("{{DELIVERABLE_INSTRUCTIONS}}", readPrompt(spec.prompt));

  const conflicts = profile.conflictPairs.length
    ? profile.conflictPairs.map(([a, b]) => `${a} ↔ ${b}`).join(", ")
    : "none";
  const user = [
    `## Evidence profile (computed by VERA)`,
    `- Items: ${profile.total} (high ${profile.byConfidence.high}, medium ${profile.byConfidence.medium}, low ${profile.byConfidence.low})`,
    `- Conflicts to surface: ${conflicts}`,
    `- Maximum readiness: ${profile.readiness}${profile.reasons.length ? ` (${profile.reasons.join("; ")})` : ""}`,
    ``,
    `## Evidence log`,
    "```json",
    JSON.stringify(log, null, 2),
    "```",
    ``,
    `Write the ${spec.title.toLowerCase()} as JSON.`,
  ].join("\n");

  return { system, user, versions: [SYSTEM_PROMPT_FILE, spec.prompt] };
}
