/**
 * Maps Vera entities to Stacks API payloads.
 *
 * Vera evidence → Stacks source
 * Vera risk → Stacks synthesis (tension)
 * Vera assumption → Stacks synthesis (insight)
 * Vera capability → Stacks synthesis (framework)
 * Vera decision → Stacks artifact (decision-brief)
 * Vera generated artifact → Stacks artifact (plan / recommendation)
 */

import type { EvidenceEntry, Risk, Assumption, Capability, Decision } from "../schema/index.ts";
import type {
  StacksSourcePayload,
  StacksSynthesisPayload,
  StacksArtifactPayload,
} from "./client.ts";

const EVIDENCE_TYPE_TO_SOURCE_TYPE: Record<string, string> = {
  stakeholder_insight: "interview",
  user_research: "doc",
  technical_constraint: "note",
  domain_assumption: "note",
  signal: "data_metric",
  decision: "note",
  client_belief: "interview",
  market_signal: "doc",
  commercial_constraint: "note",
  organizational_risk: "note",
  operational_signal: "data_metric",
  adoption_metric: "data_metric",
  performance_benchmark: "data_metric",
  incident: "note",
  learning: "note",
};

const ARTIFACT_TYPE_MAP: Record<string, string> = {
  strategy: "plan",
  roadmap: "plan",
  scope_check: "recommendation",
  backlog: "plan",
  milestone_plan: "plan",
  cost_framework: "plan",
  product_definition: "plan",
  scope_recommendation: "recommendation",
  risk_aware_pricing: "plan",
  go_no_go: "decision-brief",
  proposal_narrative: "plan",
  staffing_model: "plan",
  release_readiness: "recommendation",
  kpi_tracking: "plan",
  operational_risk_report: "risk_issue",
  adoption_analysis: "recommendation",
};

export function mapEvidence(entry: EvidenceEntry): StacksSourcePayload {
  return {
    title: `[${entry.type}] ${entry.source}`,
    content: entry.content,
    type: EVIDENCE_TYPE_TO_SOURCE_TYPE[entry.type] || "doc",
    tags: ["vera", `domain:${entry.domain}`, `type:${entry.type}`, ...entry.tags],
    status: "draft",
    visibility: "internal",
  };
}

export function mapRisk(risk: Risk): StacksSynthesisPayload {
  const content = [
    `**Risk Statement:** ${risk.statement}`,
    "",
    `- **Domain:** ${risk.domain}`,
    `- **Impact:** ${risk.impact}`,
    `- **Uncertainty:** ${risk.uncertainty}`,
    `- **Test Cost:** ${risk.test_cost}`,
    `- **Priority Score:** ${risk.priority_score?.toFixed(1) ?? "N/A"}`,
    `- **Status:** ${risk.status}`,
  ].join("\n");

  return {
    title: `Risk: ${risk.statement.slice(0, 80)}${risk.statement.length > 80 ? "..." : ""}`,
    content,
    type: "tension",
    derivedFrom: [],
    tags: ["vera", "risk", `domain:${risk.domain}`, `impact:${risk.impact}`],
    status: "draft",
    visibility: "internal",
  };
}

export function mapAssumption(assumption: Assumption): StacksSynthesisPayload {
  const content = [
    `**Assumption:** ${assumption.statement}`,
    "",
    `- **Domain:** ${assumption.domain}`,
    `- **Status:** ${assumption.status}`,
    `- **Confidence:** ${assumption.confidence}`,
    "",
    `**Success Criteria:** ${assumption.success_criteria}`,
    `**Failure Criteria:** ${assumption.failure_criteria}`,
    `**Decision Consequence:** ${assumption.decision_consequence}`,
  ].join("\n");

  return {
    title: `Assumption: ${assumption.statement.slice(0, 80)}${assumption.statement.length > 80 ? "..." : ""}`,
    content,
    type: "insight",
    derivedFrom: [],
    tags: ["vera", "assumption", `domain:${assumption.domain}`, `status:${assumption.status}`],
    status: "draft",
    visibility: "internal",
  };
}

export function mapCapability(capability: Capability): StacksSynthesisPayload {
  const content = [
    `**${capability.name}**`,
    "",
    capability.description,
    "",
    `- **Commitment State:** ${capability.commitment_state}`,
    `- **Confidence:** ${capability.confidence}`,
  ].join("\n");

  return {
    title: capability.name,
    content,
    type: "framework",
    derivedFrom: [],
    tags: ["vera", "capability", `state:${capability.commitment_state}`],
    status: "draft",
    visibility: "internal",
  };
}

export function mapDecision(decision: Decision): StacksArtifactPayload {
  const content = [
    `**Decision Type:** ${decision.type}`,
    "",
    `**Rationale:** ${decision.rationale}`,
    "",
    `- **Made by:** ${decision.made_by}`,
    `- **Date:** ${decision.date}`,
    decision.assumption_id ? `- **Assumption:** ${decision.assumption_id}` : "",
    decision.capability_id ? `- **Capability:** ${decision.capability_id}` : "",
  ].filter(Boolean).join("\n");

  return {
    title: `Decision: ${decision.rationale.slice(0, 80)}${decision.rationale.length > 80 ? "..." : ""}`,
    content,
    type: "decision-brief",
    informedBy: [],
    tags: ["vera", "decision", `type:${decision.type}`],
    status: "draft",
    visibility: "internal",
  };
}

export function mapGeneratedArtifact(
  veraType: string,
  markdownContent: string,
  informedBy: string[],
): StacksArtifactPayload {
  const stacksType = ARTIFACT_TYPE_MAP[veraType] || "plan";
  const titleMap: Record<string, string> = {
    strategy: "Strategy",
    roadmap: "Roadmap",
    scope_check: "Scope Check",
    backlog: "Backlog",
    milestone_plan: "Milestone Plan",
    cost_framework: "Cost Framework",
    product_definition: "Product Definition",
  };

  return {
    title: titleMap[veraType] || veraType.replace(/_/g, " "),
    content: markdownContent,
    type: stacksType,
    informedBy,
    tags: ["vera", "generated", `artifact:${veraType}`],
    status: "draft",
    visibility: "internal",
  };
}
