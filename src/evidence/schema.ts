import { z } from "zod/v4";

// ─── Evidence Log (v1) ───────────────────────────────────────────────────────
//
// A single, portable JSON file describing one client engagement and the
// evidence gathered so far. This is the input to the VERA pipeline.
// Strict: unknown keys are rejected so typos fail loudly instead of being
// silently ignored.

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const SourceTypeSchema = z.enum([
  "interview",
  "survey",
  "analytics",
  "usability_test",
  "experiment",
  "support_tickets",
  "sales_call",
  "stakeholder",
  "market_research",
  "competitive_analysis",
  "technical_review",
  "desk_research",
  "anecdote",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const EVIDENCE_ID_PATTERN = /^EV-\d{3}$/;

export const EvidenceItemSchema = z.strictObject({
  id: z.string().regex(EVIDENCE_ID_PATTERN, "must look like EV-001"),
  source_type: SourceTypeSchema,
  source: z.string().min(3).describe("Who or what produced this evidence"),
  summary: z.string().min(10),
  confidence: ConfidenceSchema,
  date: z.iso.date(),
  tags: z.array(z.string().min(1)).min(1),
  conflicts_with: z.array(z.string()).default([]),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceLogSchema = z
  .strictObject({
    schema_version: z.literal("1"),
    client: z.strictObject({
      name: z.string().min(1),
      industry: z.string().min(1),
      description: z.string().min(10),
    }),
    engagement: z.strictObject({
      goal: z.string().min(10),
      timeline_weeks: z.number().int().positive().optional(),
      team_size: z.number().int().positive().optional(),
      constraints: z.array(z.string()).default([]),
    }),
    items: z.array(EvidenceItemSchema).min(1, "an evidence log needs at least one item"),
  })
  .superRefine((log, ctx) => {
    const ids = new Set<string>();
    log.items.forEach((item, i) => {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "id"],
          message: `duplicate evidence id ${item.id}`,
        });
      }
      ids.add(item.id);
    });
    log.items.forEach((item, i) => {
      item.conflicts_with.forEach((ref, j) => {
        if (ref === item.id) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "conflicts_with", j],
            message: `${item.id} cannot conflict with itself`,
          });
        } else if (!ids.has(ref)) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "conflicts_with", j],
            message: `${item.id} conflicts_with unknown evidence id ${ref}`,
          });
        }
      });
    });
  });
export type EvidenceLog = z.infer<typeof EvidenceLogSchema>;
