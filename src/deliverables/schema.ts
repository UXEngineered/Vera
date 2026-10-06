import { z } from "zod/v4";
import { ConfidenceSchema } from "../evidence/schema.ts";

// ─── Model output (what the model must return) ───────────────────────────────

export const ReadinessSchema = z.enum(["ready", "partial", "insufficient_evidence"]);

export const ActionSchema = z.enum(["build", "validate", "investigate"]);
export type Action = z.infer<typeof ActionSchema>;

export const RawClaimSchema = z.strictObject({
  text: z.string().min(5),
  evidence_ids: z.array(z.string()).min(1, "every claim must cite at least one evidence id"),
  confidence: ConfidenceSchema,
  action: ActionSchema.optional(),
});
export type RawClaim = z.infer<typeof RawClaimSchema>;

export const RawSectionSchema = z.strictObject({
  id: z.string(),
  claims: z.array(RawClaimSchema),
  /** Why the section is empty or thin. Required when there are no claims. */
  note: z.string().optional(),
});
export type RawSection = z.infer<typeof RawSectionSchema>;

export const RawConflictSchema = z.strictObject({
  evidence_ids: z.array(z.string()).min(2),
  description: z.string().min(5),
  how_to_resolve: z.string().min(5),
});

export const RawGapSchema = z.strictObject({
  missing: z.string().min(5),
  why_it_matters: z.string().min(5),
  would_raise_confidence: z.string().min(5),
  related_evidence_ids: z.array(z.string()).default([]),
});

export const RawDeliverableSchema = z.strictObject({
  readiness: ReadinessSchema,
  sections: z.array(RawSectionSchema),
  conflicts: z.array(RawConflictSchema),
  gaps: z.array(RawGapSchema),
});
export type RawDeliverable = z.infer<typeof RawDeliverableSchema>;

// ─── Checked output (what VERA hands to the UI) ──────────────────────────────

export type Confidence = z.infer<typeof ConfidenceSchema>;

export interface Claim extends RawClaim {
  id: string;
  /** Confidence derived in code from the cited evidence. Authoritative. */
  derived_confidence: Confidence;
  /** True if any cited evidence is contested by another item. */
  contested: boolean;
}

export interface Section {
  id: string;
  title: string;
  claims: Claim[];
  note?: string;
}

export interface Conflict {
  id: string;
  evidence_ids: string[];
  description: string;
  how_to_resolve: string;
}

export interface Gap {
  id: string;
  missing: string;
  why_it_matters: string;
  would_raise_confidence: string;
  related_evidence_ids: string[];
}

export interface Deliverable {
  deliverable: string;
  readiness: z.infer<typeof ReadinessSchema>;
  sections: Section[];
  conflicts: Conflict[];
  gaps: Gap[];
}
