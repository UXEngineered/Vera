import type { EvidenceLog } from "../evidence/schema.ts";
import type { EvidenceProfile, Readiness } from "../evidence/validate.ts";
import { checkLanguage, deriveClaimConfidence, isAtMost } from "../confidence/rules.ts";
import { RawDeliverableSchema, type Deliverable, type RawDeliverable, type Section } from "./schema.ts";
import type { DeliverableSpec } from "./specs.ts";

export type CheckKind =
  | "schema"
  | "structure"
  | "traceability"
  | "confidence"
  | "conflict"
  | "restraint";

export interface CheckIssue {
  check: CheckKind;
  path: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  issues: CheckIssue[];
  /** Present whenever the output parsed against the schema, even if other checks failed. */
  deliverable?: Deliverable;
}

const READINESS_ORDER: Readiness[] = ["insufficient_evidence", "partial", "ready"];

/** Pull a JSON object out of model text, tolerating code fences and stray prose. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}

export function checkDeliverable(
  modelText: string,
  log: EvidenceLog,
  profile: EvidenceProfile,
  spec: DeliverableSpec,
): CheckResult {
  const issues: CheckIssue[] = [];
  const add = (check: CheckKind, path: string, message: string) => issues.push({ check, path, message });

  // 1. Parse + schema
  let json: unknown;
  try {
    json = JSON.parse(extractJson(modelText));
  } catch (e) {
    add("schema", "(root)", `output is not valid JSON: ${(e as Error).message}`);
    return { ok: false, issues };
  }
  const parsed = RawDeliverableSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add("schema", issue.path.join(".") || "(root)", issue.message);
    }
    return { ok: false, issues };
  }
  const raw: RawDeliverable = parsed.data;

  const byId = new Map(log.items.map((item) => [item.id, item]));
  const contested = new Set(profile.conflictPairs.flat());
  const knownId = (id: string) => byId.has(id);

  // 2. Structure: exactly the spec's sections, in order
  const expected = spec.sections.map((s) => s.id);
  const got = raw.sections.map((s) => s.id);
  if (expected.join(",") !== got.join(",")) {
    add("structure", "sections", `expected sections [${expected.join(", ")}], got [${got.join(", ")}]`);
  }

  // 3. Claims: traceability, confidence, language, actions
  const sections: Section[] = raw.sections.map((rs, si) => {
    const title = spec.sections.find((s) => s.id === rs.id)?.title ?? rs.id;
    if (rs.claims.length === 0 && !rs.note) {
      add("structure", `sections.${rs.id}`, "empty section must include a note explaining what evidence is missing");
    }
    const claims = rs.claims.map((rc, ci) => {
      const path = `sections.${rs.id}.claims[${ci}]`;
      const invented = rc.evidence_ids.filter((id) => !knownId(id));
      for (const id of invented) add("traceability", path, `cites ${id}, which is not in the evidence log`);

      const cited = rc.evidence_ids.filter(knownId).map((id) => ({
        confidence: byId.get(id)!.confidence,
        contested: contested.has(id),
      }));
      const derived = deriveClaimConfidence(cited);
      const isContested = cited.some((c) => c.contested);

      if (!isAtMost(rc.confidence, derived)) {
        add(
          "confidence",
          path,
          `labelled ${rc.confidence} but its evidence supports at most ${derived}${isContested ? " (cites contested evidence)" : ""}`,
        );
      }
      // Language is checked against the more cautious of the two levels.
      const effective = isAtMost(rc.confidence, derived) ? rc.confidence : derived;
      for (const v of checkLanguage(rc.text, effective)) {
        add("confidence", path, `${effective}-confidence claim ${v.detail}: "${rc.text}"`);
      }

      if (spec.requiresAction) {
        if (!rc.action) add("structure", path, "roadmap items need an action: build, validate or investigate");
        else if (rc.action === "build" && effective === "low") {
          add("confidence", path, "low-confidence item cannot be a build item; make it validate or investigate");
        }
      }

      return {
        ...rc,
        id: `${rs.id}-${ci + 1}`,
        derived_confidence: derived,
        contested: isContested,
      };
    });
    return { id: rs.id, title, claims, ...(rs.note ? { note: rs.note } : {}) };
  });

  // 4. Conflicts: every conflict in the log must be surfaced, none invented
  raw.conflicts.forEach((c, i) => {
    for (const id of c.evidence_ids) {
      if (!knownId(id)) add("traceability", `conflicts[${i}]`, `cites ${id}, which is not in the evidence log`);
    }
  });
  for (const [a, b] of profile.conflictPairs) {
    const surfaced = raw.conflicts.some((c) => c.evidence_ids.includes(a) && c.evidence_ids.includes(b));
    if (!surfaced) add("conflict", "conflicts", `conflict between ${a} and ${b} is not surfaced`);
  }

  // 5. Gaps
  raw.gaps.forEach((g, i) => {
    for (const id of g.related_evidence_ids) {
      if (!knownId(id)) add("traceability", `gaps[${i}]`, `cites ${id}, which is not in the evidence log`);
    }
  });

  // 6. Restraint: never claim more readiness than the evidence supports
  if (READINESS_ORDER.indexOf(raw.readiness) > READINESS_ORDER.indexOf(profile.readiness)) {
    add("restraint", "readiness", `readiness "${raw.readiness}" overstates the evidence; at most "${profile.readiness}"`);
  }
  const minGaps = profile.readiness === "insufficient_evidence" ? 3 : profile.readiness === "partial" ? 1 : 0;
  if (raw.gaps.length < minGaps) {
    add("restraint", "gaps", `expected at least ${minGaps} evidence gap(s) for a ${profile.readiness} log, got ${raw.gaps.length}`);
  }

  const deliverable: Deliverable = {
    deliverable: spec.id,
    readiness: raw.readiness,
    sections,
    conflicts: raw.conflicts.map((c, i) => ({ id: `conflict-${i + 1}`, ...c })),
    gaps: raw.gaps.map((g, i) => ({ id: `gap-${i + 1}`, ...g })),
  };
  return { ok: issues.length === 0, issues, deliverable };
}

export function formatCheckIssues(issues: CheckIssue[]): string {
  return issues.map((i) => `- [${i.check}] ${i.path}: ${i.message}`).join("\n");
}
