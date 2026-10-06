import type { Confidence } from "../evidence/schema.ts";

// ─── Confidence → language ───────────────────────────────────────────────────
//
// The single source of truth for how evidence confidence turns into words.
// The prompt is rendered from this table, the output checker enforces it,
// the evals score against it and the UI styles claims by it.

export interface ConfidenceRule {
  /** Short label shown in the UI. */
  label: string;
  /** How the claim should read. */
  stance: string;
  /** Example phrasings given to the model. */
  phrasing: string[];
  /** At least one of these must appear in the claim (case-insensitive). Empty = no requirement. */
  requiredMarkers: string[];
  /** None of these may appear (case-insensitive, whole word). */
  forbiddenTerms: string[];
}

/** Words that state an outcome as settled. Only high-confidence claims may use them. */
export const COMMITTED_TERMS = [
  "will",
  "must",
  "confirms",
  "confirmed",
  "proves",
  "proven",
  "definitely",
  "certainly",
  "guarantees",
  "guaranteed",
  "clearly",
  "undoubtedly",
];

export const CONFIDENCE_RULES: Record<Confidence, ConfidenceRule> = {
  high: {
    label: "Committed",
    stance: "State it directly. The evidence supports committing to it.",
    phrasing: ["will", "should", "the evidence shows"],
    requiredMarkers: [],
    forbiddenTerms: [],
  },
  medium: {
    label: "Likely",
    stance: "Directional. Say it is likely and name what would firm it up.",
    phrasing: ["likely", "evidence suggests", "early signal"],
    requiredMarkers: ["likely", "suggest", "indicate", "appear", "may", "probabl", "early signal", "early evidence"],
    forbiddenTerms: COMMITTED_TERMS,
  },
  low: {
    label: "Hypothesis to test",
    stance: "Not a conclusion. Frame it as a hypothesis and say how to test it.",
    phrasing: ["hypothesis to test:", "unvalidated", "needs evidence"],
    requiredMarkers: ["hypothes", "to test", "unvalidated", "unverified", "untested", "needs evidence", "needs validation"],
    forbiddenTerms: COMMITTED_TERMS,
  },
};

const ORDER: Confidence[] = ["low", "medium", "high"];

export function minConfidence(levels: Confidence[]): Confidence {
  if (levels.length === 0) return "low";
  return levels.reduce((a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b));
}

export function atMost(level: Confidence, cap: Confidence): Confidence {
  return minConfidence([level, cap]);
}

export function isAtMost(level: Confidence, cap: Confidence): boolean {
  return ORDER.indexOf(level) <= ORDER.indexOf(cap);
}

/**
 * Evidence contested by an item at least as strong as itself can support at
 * most a "likely" claim until the conflict is resolved. A weaker item cannot
 * demote a stronger one (a low-confidence opinion does not cap a high-confidence
 * finding), but every conflict is still surfaced.
 */
export const CONTESTED_CAP: Confidence = "medium";

/**
 * A claim's confidence is derived in code, never taken from the model:
 * the weakest evidence it cites, capped if any of that evidence is contested.
 */
export function deriveClaimConfidence(
  cited: { confidence: Confidence; contested: boolean }[],
): Confidence {
  const base = minConfidence(cited.map((c) => c.confidence));
  return cited.some((c) => c.contested) ? atMost(base, CONTESTED_CAP) : base;
}

function wordRegex(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

export interface LanguageViolation {
  kind: "forbidden_term" | "missing_marker";
  detail: string;
}

/** Check a piece of claim text against the rule for its confidence level. */
export function checkLanguage(text: string, confidence: Confidence): LanguageViolation[] {
  const rule = CONFIDENCE_RULES[confidence];
  const out: LanguageViolation[] = [];
  for (const term of rule.forbiddenTerms) {
    if (wordRegex(term).test(text)) {
      out.push({ kind: "forbidden_term", detail: `uses committed word "${term}"` });
    }
  }
  if (rule.requiredMarkers.length > 0) {
    const lower = text.toLowerCase();
    if (!rule.requiredMarkers.some((m) => lower.includes(m))) {
      out.push({
        kind: "missing_marker",
        detail: `needs a ${rule.label.toLowerCase()} marker such as "${rule.phrasing[0]}"`,
      });
    }
  }
  return out;
}

/** Render the rules as prompt text so the prompt and the checker can never drift. */
export function renderRulesForPrompt(): string {
  const lines = (["high", "medium", "low"] as Confidence[]).map((level) => {
    const r = CONFIDENCE_RULES[level];
    const forbidden = r.forbiddenTerms.length
      ? ` Never use: ${r.forbiddenTerms.map((t) => `"${t}"`).join(", ")}.`
      : "";
    const required = r.requiredMarkers.length
      ? ` Must include one of: ${r.requiredMarkers.map((t) => `"${t}"`).join(", ")}.`
      : "";
    return `- ${level.toUpperCase()} → "${r.label}". ${r.stance} Example phrasing: ${r.phrasing
      .map((p) => `"${p}"`)
      .join(", ")}.${required}${forbidden}`;
  });
  return [
    ...lines,
    `- A claim's confidence is the LOWEST confidence among the evidence it cites.`,
    `- If any cited evidence is contested (listed as contested in the evidence profile), the claim is at most ${CONTESTED_CAP.toUpperCase()}.`,
  ].join("\n");
}

// ─── Confidence → eval role (eval suite deliverable) ─────────────────────────
//
// How much an eval case counts is set by the evidence behind it, the same way
// wording is. Only well-evidenced behaviour may block a release.

export type EvalRole = "regression" | "capability" | "exploratory";

export const EVAL_ROLES: Record<Confidence, { role: EvalRole; label: string; blocking: boolean; meaning: string }> = {
  high: { role: "regression", label: "Regression", blocking: true, meaning: "Must pass. A failure blocks release." },
  medium: { role: "capability", label: "Capability", blocking: false, meaning: "Tracked against a threshold. Does not block." },
  low: { role: "exploratory", label: "Exploratory", blocking: false, meaning: "A hypothesis test. Its result decides whether to commit." },
};

export function evalRoleFor(confidence: Confidence): EvalRole {
  return EVAL_ROLES[confidence].role;
}

/** Pass criteria that only a judgement call could check. */
export const VAGUE_CRITERIA_TERMS = [
  "good", "well", "appropriate", "appropriately", "reasonable", "reasonably", "helpful",
  "high quality", "properly", "correctly", "nice", "satisfactory", "adequate", "as expected",
];

/** Words that point at something observable in the output or trace. */
export const OBSERVABLE_CRITERIA_TERMS = [
  "contains", "does not contain", "includes", "omits", "mentions", "never", "always", "exactly",
  "calls", "does not call", "returns", "matches", "equals", "cites", "quotes", "refuses",
  "escalates", "hands off", "asks for", "within", "at least", "at most", "fewer than", "more than",
];

/**
 * A pass criterion is measurable when it avoids judgement words and names a
 * threshold (a number) or an observable behaviour.
 */
export function checkMeasurable(criteria: string): string[] {
  const out: string[] = [];
  for (const term of VAGUE_CRITERIA_TERMS) {
    if (wordRegex(term).test(criteria)) out.push(`uses judgement word "${term}"`);
  }
  const lower = criteria.toLowerCase();
  const hasNumber = /\d/.test(criteria);
  const hasObservable = OBSERVABLE_CRITERIA_TERMS.some((t) => lower.includes(t));
  if (!hasNumber && !hasObservable) out.push("names no threshold or observable behaviour");
  return out;
}
