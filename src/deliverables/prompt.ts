import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_ROLES, renderRulesForPrompt, VAGUE_CRITERIA_TERMS } from "../confidence/rules.ts";
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

function extraClaimFields(spec: DeliverableSpec): string {
  if (spec.requiresAction) return `, "action": "build" | "validate" | "investigate"`;
  if (spec.requiresEvalFields) return `, "scenario": "...", "pass_criteria": "...", "grader": "code" | "model" | "human"`;
  return "";
}

/** Deliverable prompt file, with any tables rendered from the rules so they cannot drift. */
function renderDeliverablePrompt(spec: DeliverableSpec): string {
  const roles = (["high", "medium", "low"] as const)
    .map((c) => `- ${c.toUpperCase()} confidence → \`${EVAL_ROLES[c].role}\`: ${EVAL_ROLES[c].meaning}`)
    .join("\n");
  return readPrompt(spec.prompt)
    .replace("{{EVAL_ROLES}}", roles)
    .replace("{{VAGUE_TERMS}}", VAGUE_CRITERIA_TERMS.map((t) => `"${t}"`).join(", "));
}

export function buildPrompt(spec: DeliverableSpec, log: EvidenceLog, profile: EvidenceProfile): BuiltPrompt {
  const sections = spec.sections.map((s) => `- \`${s.id}\` (${s.title}): ${s.purpose}`).join("\n");
  const system = readPrompt(SYSTEM_PROMPT_FILE)
    .replaceAll("{{DELIVERABLE_TITLE}}", spec.title.toLowerCase())
    .replace("{{CONFIDENCE_RULES}}", renderRulesForPrompt())
    .replace("{{ACTION_FIELD}}", extraClaimFields(spec))
    .replace("{{SECTIONS}}", sections)
    .replace("{{DELIVERABLE_INSTRUCTIONS}}", renderDeliverablePrompt(spec));

  const conflicts = profile.conflictPairs.length
    ? profile.conflictPairs.map(([a, b]) => `${a} ↔ ${b}`).join(", ")
    : "none";
  const user = [
    `## Evidence profile (computed by VERA)`,
    `- Items: ${profile.total} (high ${profile.byConfidence.high}, medium ${profile.byConfidence.medium}, low ${profile.byConfidence.low})`,
    `- Conflicts to surface: ${conflicts}`,
    `- Contested (claims citing these are at most medium): ${profile.contested.length ? profile.contested.join(", ") : "none"}`,
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
