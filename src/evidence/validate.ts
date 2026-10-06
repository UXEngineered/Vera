import { EvidenceLogSchema, type EvidenceLog, type Confidence } from "./schema.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; log: EvidenceLog }
  | { ok: false; issues: ValidationIssue[] };

function formatPath(path: PropertyKey[], raw: unknown): string {
  // Turn ["items", 3, "confidence"] into "items[3] (EV-004).confidence"
  let out = "";
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    if (typeof seg === "number") {
      out += `[${seg}]`;
      if (path[i - 1] === "items") {
        const id = (raw as { items?: { id?: unknown }[] })?.items?.[seg]?.id;
        if (typeof id === "string") out += ` (${id})`;
      }
    } else {
      out += out ? `.${String(seg)}` : String(seg);
    }
  }
  return out || "(root)";
}

/** Validate an already-parsed value against the evidence log schema. */
export function validateEvidenceLog(raw: unknown): ValidationResult {
  const parsed = EvidenceLogSchema.safeParse(raw);
  if (parsed.success) return { ok: true, log: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path, raw),
      message: issue.message,
    })),
  };
}

/** Parse JSON text and validate it. Bad JSON is reported as a validation issue. */
export function parseEvidenceLog(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: `not valid JSON: ${(e as Error).message}` }],
    };
  }
  return validateEvidenceLog(raw);
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
}

// ─── Evidence profile ────────────────────────────────────────────────────────

export type Readiness = "ready" | "partial" | "insufficient_evidence";

export interface EvidenceProfile {
  total: number;
  byConfidence: Record<Confidence, number>;
  conflictPairs: [string, string][];
  /**
   * Items contested by evidence at least as strong as themselves. A weaker item
   * cannot demote a stronger one; the conflict is still surfaced either way.
   */
  contested: string[];
  /** The most VERA is allowed to claim about this log as a whole. */
  readiness: Readiness;
  reasons: string[];
}

/**
 * Deterministic summary of how much the log can support. Computed in code,
 * passed to the model, and enforced on its output: the model may be more
 * cautious than this, never less.
 */
export function profileEvidence(log: EvidenceLog): EvidenceProfile {
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const item of log.items) byConfidence[item.confidence]++;

  const seen = new Set<string>();
  const conflictPairs: [string, string][] = [];
  for (const item of log.items) {
    for (const other of item.conflicts_with) {
      const pair = [item.id, other].sort() as [string, string];
      const key = pair.join("|");
      if (!seen.has(key)) {
        seen.add(key);
        conflictPairs.push(pair);
      }
    }
  }

  const rank = { low: 0, medium: 1, high: 2 } as const;
  const byId = new Map(log.items.map((item) => [item.id, item]));
  const contested = new Set<string>();
  for (const [a, b] of conflictPairs) {
    const ea = byId.get(a)!;
    const eb = byId.get(b)!;
    if (rank[eb.confidence] >= rank[ea.confidence]) contested.add(a);
    if (rank[ea.confidence] >= rank[eb.confidence]) contested.add(b);
  }

  const reasons: string[] = [];
  let readiness: Readiness = "ready";
  if (log.items.length < 5) reasons.push(`only ${log.items.length} evidence item(s)`);
  if (byConfidence.high === 0) reasons.push("no high-confidence evidence");
  if (reasons.length > 0) {
    readiness = "insufficient_evidence";
  } else {
    if (conflictPairs.length > 0) reasons.push(`${conflictPairs.length} unresolved conflict(s)`);
    if (byConfidence.high < log.items.length / 2) reasons.push("less than half the evidence is high confidence");
    if (reasons.length > 0) readiness = "partial";
  }

  return {
    total: log.items.length,
    byConfidence,
    conflictPairs,
    contested: log.items.map((i) => i.id).filter((id) => contested.has(id)),
    readiness,
    reasons,
  };
}
