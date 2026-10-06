import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeliverableId } from "../deliverables/specs.ts";
import type { EvidenceLog } from "../evidence/schema.ts";
import { parseEvidenceLog, profileEvidence, type EvidenceProfile } from "../evidence/validate.ts";

const ROOT = join(import.meta.dir, "..", "..");
export const SAMPLE_NAMES = ["strong", "mixed", "thin"] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

export interface Sample {
  name: SampleName;
  label: string;
  blurb: string;
  log: EvidenceLog;
  profile: EvidenceProfile;
}

const META: Record<SampleName, { label: string; blurb: string }> = {
  strong: { label: "Strong evidence", blurb: "Consistent, mostly high-confidence evidence, including a randomized pilot." },
  mixed: { label: "Mixed evidence", blurb: "Medium-confidence evidence with two unresolved conflicts." },
  thin: { label: "Thin evidence", blurb: "Three low-confidence items. VERA should hold back." },
};

export function loadSamples(): Sample[] {
  return SAMPLE_NAMES.map((name) => {
    const r = parseEvidenceLog(readFileSync(join(ROOT, "examples", "logs", `${name}.json`), "utf-8"));
    if (!r.ok) throw new Error(`sample ${name} is invalid`);
    return { name, ...META[name], log: r.log, profile: profileEvidence(r.log) };
  });
}

/** Recorded model outputs from `bun run eval --record`, used when live generation is unavailable. */
export function loadRecording(name: SampleName, deliverable: DeliverableId): { model: string; outputs: string[] } | null {
  const path = join(ROOT, "evals", "recordings", `${name}.${deliverable}.json`);
  if (!existsSync(path)) return null;
  const rec = JSON.parse(readFileSync(path, "utf-8"));
  return { model: rec.model, outputs: rec.outputs };
}
