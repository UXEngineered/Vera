import { checkMeasurable, EVAL_ROLES } from "../confidence/rules.ts";
import type { EvidenceLog } from "../evidence/schema.ts";
import type { Deliverable } from "./schema.ts";

// ─── Eval suite export (plain JSON) ──────────────────────────────────────────
//
// A self-contained file a harness team can load into whatever runs their
// evals. Only cases in sections a person has approved are exported; edits
// made during review replace the generated text and are marked.

export const EVAL_SUITE_FORMAT = "vera.eval_suite/1";

export interface ReviewInput {
  /** section id → ISO time it was approved */
  approved: Record<string, string>;
  /** claim id → edited text */
  edits: Record<string, string>;
  /** claim id → edited pass criteria (eval suites) */
  criteria?: Record<string, string>;
}

export interface EvalCaseExport {
  id: string;
  role: "regression" | "capability" | "exploratory";
  blocking: boolean;
  behaviour: string;
  scenario: string;
  pass_criteria: string;
  /** Non-empty only when a reviewer kept pass criteria a harness can't check reliably. */
  criteria_warnings: string[];
  grader: "code" | "model" | "human";
  confidence: "high" | "medium" | "low";
  contested: boolean;
  edited: boolean;
  approved_at: string;
  evidence: { id: string; source_type: string; summary: string; confidence: string }[];
}

export interface EvalSuiteExport {
  format: typeof EVAL_SUITE_FORMAT;
  client: string;
  generated: { model: string; prompt_versions: string[]; run_id: string };
  exported_at: string;
  readiness: Deliverable["readiness"];
  counts: {
    regression: number;
    capability: number;
    exploratory: number;
    blocking: number;
    with_criteria_warnings: number;
    unapproved_sections: string[];
  };
  cases: EvalCaseExport[];
  conflicts: Deliverable["conflicts"];
  gaps: Deliverable["gaps"];
}

export function toEvalSuiteJson(
  d: Deliverable,
  log: EvidenceLog,
  review: ReviewInput,
  meta: { model: string; prompt_versions: string[]; run_id: string },
  now = new Date(),
): EvalSuiteExport {
  if (d.deliverable !== "eval_suite") throw new Error(`expected an eval suite, got ${d.deliverable}`);
  const byId = new Map(log.items.map((i) => [i.id, i]));

  const cases: EvalCaseExport[] = d.sections
    .filter((s) => review.approved[s.id])
    .flatMap((s) =>
      s.claims.map((c) => {
        const role = s.id as EvalCaseExport["role"];
        const pass_criteria = review.criteria?.[c.id] ?? c.pass_criteria!;
        return {
          id: c.id,
          role,
          // Blocking follows the section the case was approved in, which the checker caps by evidence.
          blocking: role === EVAL_ROLES.high.role,
          behaviour: review.edits[c.id] ?? c.text,
          scenario: c.scenario!,
          pass_criteria,
          criteria_warnings: checkMeasurable(pass_criteria),
          grader: c.grader!,
          confidence: c.confidence,
          contested: c.contested,
          edited: c.id in review.edits || c.id in (review.criteria ?? {}),
          approved_at: review.approved[s.id]!,
          evidence: c.evidence_ids.map((id) => {
            const e = byId.get(id)!;
            return { id, source_type: e.source_type, summary: e.summary, confidence: e.confidence };
          }),
        };
      }),
    );

  const count = (role: EvalCaseExport["role"]) => cases.filter((c) => c.role === role).length;
  return {
    format: EVAL_SUITE_FORMAT,
    client: log.client.name,
    generated: meta,
    exported_at: now.toISOString(),
    readiness: d.readiness,
    counts: {
      regression: count("regression"),
      capability: count("capability"),
      exploratory: count("exploratory"),
      blocking: cases.filter((c) => c.blocking).length,
      with_criteria_warnings: cases.filter((c) => c.criteria_warnings.length > 0).length,
      unapproved_sections: d.sections.filter((s) => !review.approved[s.id]).map((s) => s.id),
    },
    cases,
    conflicts: d.conflicts,
    gaps: d.gaps,
  };
}
