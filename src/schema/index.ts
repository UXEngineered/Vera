import { z } from "zod/v4";

// ─── Domain Enums ────────────────────────────────────────────────────────────

export const RiskDomainSchema = z.enum([
  "value",
  "usability",
  "feasibility",
  "viability",
  "operational",
]);
export type RiskDomain = z.infer<typeof RiskDomainSchema>;

export const EvidenceTypeSchema = z.enum([
  // Core discovery
  "stakeholder_insight",
  "user_research",
  "technical_constraint",
  "domain_assumption",
  "signal",
  "decision",
  // Presales / early exploration
  "client_belief",
  "market_signal",
  "commercial_constraint",
  "organizational_risk",
  // Delivery / production
  "operational_signal",
  "adoption_metric",
  "performance_benchmark",
  "incident",
  "learning",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const ConfidenceImpactSchema = z.enum([
  "increases",
  "decreases",
  "neutral",
]);

export const ImpactLevelSchema = z.enum(["critical", "high", "medium", "low"]);
export const UncertaintyLevelSchema = z.enum(["high", "medium", "low"]);
export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export const CommitmentStateSchema = z.enum([
  "concept",
  "validation",
  "commitment",
]);

// ─── Evidence Entry ──────────────────────────────────────────────────────────

export const EvidenceEntrySchema = z.object({
  id: z.string(),
  type: EvidenceTypeSchema,
  source: z.string(),
  date: z.string(),
  content: z.string(),
  assumptions: z.array(z.string()).default([]),
  confidence_impact: ConfidenceImpactSchema.default("neutral"),
  domain: RiskDomainSchema,
  capability_id: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

// ─── Risk ────────────────────────────────────────────────────────────────────

export const RiskStatusSchema = z.enum([
  "open",
  "mitigated",
  "accepted",
  "closed",
]);

export const RiskSchema = z.object({
  id: z.string(),
  statement: z.string(),
  domain: RiskDomainSchema,
  capability_id: z.string(),
  impact: ImpactLevelSchema,
  uncertainty: UncertaintyLevelSchema,
  test_cost: ImpactLevelSchema.default("medium"),
  priority_score: z.number().optional(),
  assumptions: z.array(z.string()).default([]),
  status: RiskStatusSchema.default("open"),
  created_date: z.string(),
  updated_date: z.string(),
});
export type Risk = z.infer<typeof RiskSchema>;

// ─── Assumption ──────────────────────────────────────────────────────────────

export const AssumptionStatusSchema = z.enum([
  "untested",
  "testing",
  "validated",
  "invalidated",
  "conditional",
  "candidate",
]);

export const AssumptionSchema = z.object({
  id: z.string(),
  risk_id: z.string(),
  statement: z.string(),
  domain: RiskDomainSchema,
  status: AssumptionStatusSchema.default("untested"),
  confidence: ConfidenceLevelSchema.default("low"),
  success_criteria: z.string(),
  failure_criteria: z.string(),
  decision_consequence: z.string(),
  linked_evidence: z.array(z.string()).default([]),
  linked_slices: z.array(z.string()).default([]),
  capability_id: z.string(),
  created_date: z.string(),
  updated_date: z.string(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

// ─── Slice ───────────────────────────────────────────────────────────────────

export const SliceTypeSchema = z.enum([
  "user_signal",
  "feasibility",
  "viability",
  "operational",
]);

export const SliceStatusSchema = z.enum([
  "planned",
  "in_progress",
  "complete",
  "abandoned",
]);

export const SignalDefinitionSchema = z.object({
  success: z.string(),
  failure: z.string(),
  promotion_trigger: z.string(),
});

export const SliceSchema = z.object({
  id: z.string(),
  assumption_id: z.string(),
  type: SliceTypeSchema,
  description: z.string(),
  time_box: z.string(),
  instrumentation: z.string(),
  signal_definition: SignalDefinitionSchema,
  status: SliceStatusSchema.default("planned"),
  signal_captured: z.string().optional(),
  created_date: z.string(),
  completed_date: z.string().optional(),
});
export type Slice = z.infer<typeof SliceSchema>;

// ─── Capability ──────────────────────────────────────────────────────────────

export const PromotionRecordSchema = z.object({
  from_state: z.string(),
  to_state: z.string(),
  date: z.string(),
  rationale: z.string(),
  evidence_ids: z.array(z.string()).default([]),
});
export type PromotionRecord = z.infer<typeof PromotionRecordSchema>;

export const CapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  commitment_state: CommitmentStateSchema.default("concept"),
  confidence: ConfidenceLevelSchema.default("low"),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  promotion_history: z.array(PromotionRecordSchema).default([]),
});
export type Capability = z.infer<typeof CapabilitySchema>;

// ─── Decision ────────────────────────────────────────────────────────────────

export const DecisionTypeSchema = z.enum([
  "promote",
  "iterate",
  "pivot",
  "stop",
]);

export const DecisionSchema = z.object({
  id: z.string(),
  type: DecisionTypeSchema,
  assumption_id: z.string().optional(),
  capability_id: z.string().optional(),
  rationale: z.string(),
  evidence_ids: z.array(z.string()).default([]),
  date: z.string(),
  made_by: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ─── Engagement Context ──────────────────────────────────────────────────────

export const TeamMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  allocation: z.number(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const EngagementContextSchema = z.object({
  engagement_id: z.string(),
  client_name: z.string(),
  duration_weeks: z.number(),
  team: z.array(TeamMemberSchema).default([]),
  delivery_cadence: z.string().default("weekly sprint"),
  commercial_structure: z.string().default("T&M"),
  client_constraints: z.array(z.string()).default([]),
  deliverables_required: z.array(z.string()).default([]),
  start_date: z.string(),
  current_week: z.number().default(1),
});
export type EngagementContext = z.infer<typeof EngagementContextSchema>;

// ─── Monitor Types ───────────────────────────────────────────────────────────

export const AlertSeveritySchema = z.enum(["critical", "warning", "info"]);

export const AlertSchema = z.object({
  severity: AlertSeveritySchema,
  entity_type: z.string(),
  entity_id: z.string(),
  message: z.string(),
  suggested_action: z.string().optional(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const EvidenceHealthSchema = z.enum([
  "healthy",
  "gaps_present",
  "critical_gaps",
]);

export const RiskPrioritySummarySchema = z.object({
  risk_id: z.string(),
  statement: z.string(),
  domain: RiskDomainSchema,
  impact: ImpactLevelSchema,
  uncertainty: UncertaintyLevelSchema,
  test_cost: ImpactLevelSchema,
  priority_score: z.number(),
  has_assumptions: z.boolean(),
  active_slices: z.number(),
});
export type RiskPrioritySummary = z.infer<typeof RiskPrioritySummarySchema>;

export const MonitorReportSchema = z.object({
  generated_at: z.string(),
  gaps: z.array(AlertSchema),
  drift_warnings: z.array(AlertSchema),
  staleness_warnings: z.array(AlertSchema),
  state_inconsistencies: z.array(AlertSchema),
  risk_priority_ranking: z.array(RiskPrioritySummarySchema),
  overall_evidence_health: EvidenceHealthSchema,
});
export type MonitorReport = z.infer<typeof MonitorReportSchema>;

// ─── Candidate Assumption ────────────────────────────────────────────────────

export const CandidateAssumptionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  domain: RiskDomainSchema,
  success_criteria: z.string(),
  failure_criteria: z.string(),
  decision_consequence: z.string(),
  risk_id: z.string(),
  capability_id: z.string(),
  status: z.literal("candidate"),
  created_date: z.string(),
});
export type CandidateAssumption = z.infer<typeof CandidateAssumptionSchema>;

// ─── VERA Config ─────────────────────────────────────────────────────────────

export const ArtifactTypeSchema = z.enum([
  "strategy",
  "roadmap",
  "scope_check",
  "backlog",
  "milestone_plan",
  "cost_framework",
  "product_definition",
  // Presales
  "scope_recommendation",
  "risk_aware_pricing",
  "go_no_go",
  "proposal_narrative",
  "staffing_model",
  // Delivery
  "release_readiness",
  "kpi_tracking",
  "operational_risk_report",
  "adoption_analysis",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const StacksConfigSchema = z.object({
  url: z.string(),
  fieldbook_id: z.string(),
  sync_enabled: z.boolean().default(true),
});
export type StacksConfig = z.infer<typeof StacksConfigSchema>;

export const VeraConfigSchema = z.object({
  artifacts_enabled: z.array(ArtifactTypeSchema).default([
    "strategy",
    "roadmap",
    "scope_check",
  ]),
  slack_webhook: z.string().optional(),
  watch: z.object({
    enabled: z.boolean().default(true),
    debounce_ms: z.number().default(2000),
  }).default({}),
  llm: z.object({
    provider: z.string().default("portkey"),
    generation_model: z.string().default("claude-opus-4-5"),
    validation_model: z.string().default("claude-sonnet-4-20250514"),
  }).default({}),
  stacks: StacksConfigSchema.optional(),
});
export type VeraConfig = z.infer<typeof VeraConfigSchema>;

// ─── Manifest ────────────────────────────────────────────────────────────────

export const ManifestEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  last_modified: z.string(),
  file_path: z.string(),
});

export const ManifestSchema = z.object({
  last_updated: z.string(),
  entries: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
