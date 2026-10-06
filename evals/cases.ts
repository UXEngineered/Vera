import type { CheckIssue } from "../src/deliverables/check.ts";
import type { Claim, Deliverable } from "../src/deliverables/schema.ts";
import type { DeliverableId } from "../src/deliverables/specs.ts";
import type { EvidenceLog } from "../src/evidence/schema.ts";
import type { EvidenceProfile } from "../src/evidence/validate.ts";
import { checkLanguage, isAtMost } from "../src/confidence/rules.ts";

// ─── Eval cases ──────────────────────────────────────────────────────────────
//
// Each case asserts one behaviour the brief cares about against one or more
// pipeline runs (sample log × deliverable). Cases are deliberately written
// against the final, checked output AND independently of the checker where
// possible, so a bug in the checker does not silently pass the evals.

export type LogName = "strong" | "mixed" | "thin";
export type RunKey = `${LogName}.${DeliverableId}`;

export interface RunOutcome {
  key: RunKey;
  log: EvidenceLog;
  profile: EvidenceProfile;
  ok: boolean;
  attempts: number;
  deliverable?: Deliverable;
  issues: CheckIssue[];
  error?: string;
}

export interface EvalCase {
  id: string;
  category: "schema" | "traceability" | "confidence" | "restraint" | "conflict";
  description: string;
  runs: RunKey[];
  /** Return a list of failures; empty = pass. */
  assert: (run: RunOutcome) => string[];
}

const ALL_RUNS: RunKey[] = [
  "strong.strategy",
  "strong.roadmap",
  "mixed.strategy",
  "mixed.roadmap",
  "thin.strategy",
  "thin.roadmap",
];

const claims = (d: Deliverable): Claim[] => d.sections.flatMap((s) => s.claims);
const need = (run: RunOutcome): Deliverable => {
  if (!run.deliverable) throw new Error(run.error ?? "no parseable output");
  return run.deliverable;
};

export const CASES: EvalCase[] = [
  // ── Schema validity: output parses and passes all checks within the retry cap
  ...ALL_RUNS.map(
    (key): EvalCase => ({
      id: `schema.${key}`,
      category: "schema",
      description: `${key}: valid output within the retry cap`,
      runs: [key],
      assert: (run) => (run.ok ? [] : [run.error ?? `${run.issues.length} check issue(s) after ${run.attempts} attempts`]),
    }),
  ),

  // ── Traceability: every claim cites ≥1 real evidence id; nothing invented anywhere
  ...(["strong", "mixed", "thin"] as const).map(
    (log): EvalCase => ({
      id: `traceability.${log}`,
      category: "traceability",
      description: `${log}: every claim cites real evidence; no invented ids`,
      runs: [`${log}.strategy`, `${log}.roadmap`],
      assert: (run) => {
        const d = need(run);
        const ids = new Set(run.log.items.map((i) => i.id));
        const out: string[] = [];
        for (const c of claims(d)) {
          if (c.evidence_ids.length === 0) out.push(`${c.id} cites nothing`);
          for (const id of c.evidence_ids) if (!ids.has(id)) out.push(`${c.id} invents ${id}`);
        }
        for (const x of d.conflicts) for (const id of x.evidence_ids) if (!ids.has(id)) out.push(`${x.id} invents ${id}`);
        for (const g of d.gaps) for (const id of g.related_evidence_ids) if (!ids.has(id)) out.push(`${g.id} invents ${id}`);
        return out;
      },
    }),
  ),

  // ── Confidence fidelity
  {
    id: "confidence.language",
    category: "confidence",
    description: "no claim uses committed language above its evidence",
    runs: ALL_RUNS,
    assert: (run) =>
      claims(need(run)).flatMap((c) => {
        const out: string[] = [];
        if (!isAtMost(c.confidence, c.derived_confidence)) out.push(`${c.id} labelled ${c.confidence}, evidence supports ${c.derived_confidence}`);
        const level = isAtMost(c.confidence, c.derived_confidence) ? c.confidence : c.derived_confidence;
        for (const v of checkLanguage(c.text, level)) out.push(`${c.id}: ${v.detail}`);
        return out;
      }),
  },
  {
    id: "confidence.thin-never-commits",
    category: "confidence",
    description: "thin log: every claim is a low-confidence hypothesis",
    runs: ["thin.strategy", "thin.roadmap"],
    assert: (run) => claims(need(run)).filter((c) => c.confidence !== "low").map((c) => `${c.id} is ${c.confidence}`),
  },
  {
    id: "confidence.strong-commits",
    category: "confidence",
    description: "strong log: VERA commits where the evidence is strong (≥3 high claims, ≥1 build item)",
    runs: ["strong.strategy", "strong.roadmap"],
    assert: (run) => {
      const d = need(run);
      const out: string[] = [];
      const high = claims(d).filter((c) => c.confidence === "high").length;
      if (high < 3) out.push(`only ${high} high-confidence claim(s); over-hedging strong evidence`);
      if (d.deliverable === "roadmap" && !claims(d).some((c) => c.action === "build")) out.push("no build items on a strong log");
      if (d.readiness !== "ready") out.push(`readiness ${d.readiness}, expected ready`);
      return out;
    },
  },

  // ── Restraint on thin evidence
  {
    id: "restraint.thin-strategy",
    category: "restraint",
    description: "thin strategy: flags insufficient evidence, ≥3 gaps, ≤8 claims",
    runs: ["thin.strategy"],
    assert: (run) => {
      const d = need(run);
      const out: string[] = [];
      if (d.readiness !== "insufficient_evidence") out.push(`readiness ${d.readiness}`);
      if (d.gaps.length < 3) out.push(`${d.gaps.length} gap(s)`);
      const n = claims(d).length;
      if (n > 8) out.push(`${n} claims from 3 low-confidence items`);
      return out;
    },
  },
  {
    id: "restraint.thin-roadmap",
    category: "restraint",
    description: "thin roadmap: no build items, ≥3 gaps",
    runs: ["thin.roadmap"],
    assert: (run) => {
      const d = need(run);
      const out = claims(d).filter((c) => c.action === "build").map((c) => `${c.id} is a build item`);
      if (d.gaps.length < 3) out.push(`${d.gaps.length} gap(s)`);
      if (d.readiness !== "insufficient_evidence") out.push(`readiness ${d.readiness}`);
      return out;
    },
  },

  // ── Conflict handling
  {
    id: "conflict.surfaced",
    category: "conflict",
    description: "mixed log: both conflicts surfaced with both sides cited",
    runs: ["mixed.strategy", "mixed.roadmap"],
    assert: (run) => {
      const d = need(run);
      return run.profile.conflictPairs
        .filter(([a, b]) => !d.conflicts.some((c) => c.evidence_ids.includes(a) && c.evidence_ids.includes(b)))
        .map(([a, b]) => `${a} ↔ ${b} not surfaced`);
    },
  },
  {
    id: "conflict.not-resolved-silently",
    category: "conflict",
    description: "mixed log: no high-confidence claim or build item rests on contested evidence",
    runs: ["mixed.strategy", "mixed.roadmap"],
    assert: (run) =>
      claims(need(run))
        .filter((c) => c.contested && (c.confidence === "high" || c.action === "build"))
        .map((c) => `${c.id} commits on contested evidence: "${c.text}"`),
  },
];
