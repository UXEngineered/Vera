import type { EvidenceStore } from "../store/types.ts";
import type {
  Alert,
  MonitorReport,
  RiskPrioritySummary,
  RiskDomain,
  Risk,
} from "../schema/index.ts";
import { computeRiskPriority, daysSince, parseTimebox } from "../utils.ts";

const ALL_DOMAINS: RiskDomain[] = ["value", "usability", "feasibility", "viability", "operational"];

export async function runMonitor(store: EvidenceStore): Promise<MonitorReport> {
  const [risks, assumptions, slices, capabilities, evidence] = await Promise.all([
    store.listRisks(),
    store.listAssumptions(),
    store.listSlices(),
    store.listCapabilities(),
    store.listEvidence(),
  ]);

  const gaps: Alert[] = [];
  const drift_warnings: Alert[] = [];
  const staleness_warnings: Alert[] = [];
  const state_inconsistencies: Alert[] = [];

  // ─── Gap Detection (Spec 3.2) ────────────────────────────────────

  // Risks with no assumptions
  for (const risk of risks) {
    if (risk.status !== "open") continue;
    const riskAssumptions = assumptions.filter((a) => a.risk_id === risk.id);
    if (riskAssumptions.length === 0) {
      gaps.push({
        severity: "warning",
        entity_type: "risk",
        entity_id: risk.id,
        message: `Risk ${risk.id} has no testable assumptions. Candidate assumptions needed.`,
        suggested_action: `Run: vera generate assumptions --risk ${risk.id}`,
      });
    }
  }

  // Assumptions with no slices
  for (const assumption of assumptions) {
    if (assumption.status === "validated" || assumption.status === "invalidated") continue;
    if (assumption.status === "untested") {
      const asmSlices = slices.filter((s) => s.assumption_id === assumption.id);
      if (asmSlices.length === 0) {
        gaps.push({
          severity: "info",
          entity_type: "assumption",
          entity_id: assumption.id,
          message: `Assumption ${assumption.id} has no planned slice.`,
          suggested_action: `Plan a test slice for: "${assumption.statement.slice(0, 60)}..."`,
        });
      }
    }
  }

  // Capabilities with no evidence in a risk domain
  for (const cap of capabilities) {
    for (const domain of ALL_DOMAINS) {
      const domainEvidence = evidence.filter(
        (e) => e.capability_id === cap.id && e.domain === domain,
      );
      if (domainEvidence.length === 0) {
        gaps.push({
          severity: "warning",
          entity_type: "capability",
          entity_id: cap.id,
          message: `Capability ${cap.id} (${cap.name}) has no evidence in the "${domain}" domain.`,
        });
      }
    }
  }

  // Global domain coverage
  for (const domain of ALL_DOMAINS) {
    const domainEvidence = evidence.filter((e) => e.domain === domain);
    if (domainEvidence.length === 0) {
      gaps.push({
        severity: "warning",
        entity_type: "domain",
        entity_id: domain,
        message: `No evidence exists in the "${domain}" domain. This risk area is completely unexamined.`,
      });
    }
  }

  // ─── State Inconsistencies ───────────────────────────────────────

  // Capability in "commitment" with untested assumptions
  for (const cap of capabilities) {
    if (cap.commitment_state !== "commitment") continue;
    const capAssumptions = assumptions.filter((a) => a.capability_id === cap.id);
    const untested = capAssumptions.filter((a) => a.status === "untested");
    if (untested.length > 0) {
      state_inconsistencies.push({
        severity: "critical",
        entity_type: "capability",
        entity_id: cap.id,
        message: `${cap.id} (${cap.name}) is in Commitment but has ${untested.length} untested assumption(s): ${untested.map((a) => a.id).join(", ")}. Cannot commit with unvalidated assumptions.`,
        suggested_action: `Resolve untested assumptions or return capability to Validation state.`,
      });
    }
  }

  // ─── Drift Detection (Spec 3.3) ──────────────────────────────────

  const openRisks = risks.filter((r) => r.status === "open");
  const rankedRisks = openRisks
    .map((r) => ({
      ...r,
      computed_priority: computeRiskPriority(r.impact, r.uncertainty, r.test_cost),
    }))
    .sort((a, b) => b.computed_priority - a.computed_priority);

  const activeSlices = slices.filter((s) => s.status === "in_progress");

  if (rankedRisks.length >= 3 && activeSlices.length > 0) {
    const top3RiskIds = new Set(rankedRisks.slice(0, 3).map((r) => r.id));

    // Find which risks active slices are addressing
    const activeRiskIds = new Set<string>();
    for (const slice of activeSlices) {
      const parentAssumption = assumptions.find((a) => a.id === slice.assumption_id);
      if (parentAssumption) {
        activeRiskIds.add(parentAssumption.risk_id);
      }
    }

    const addressingTop3 = [...top3RiskIds].some((id) => activeRiskIds.has(id));

    if (!addressingTop3) {
      const topUnaddressed = rankedRisks.slice(0, 3).map((r) => `${r.id} (${r.impact})`).join(", ");
      drift_warnings.push({
        severity: "warning",
        entity_type: "system",
        entity_id: "drift",
        message: `Active work is not addressing top 3 priority risks. Top unaddressed: ${topUnaddressed}.`,
        suggested_action: `Realign active slices to address highest-priority risks.`,
      });
    }

    // Active slices on low-priority risks while top risks are unaddressed
    for (const slice of activeSlices) {
      const parentAssumption = assumptions.find((a) => a.id === slice.assumption_id);
      if (!parentAssumption) continue;
      const parentRisk = rankedRisks.find((r) => r.id === parentAssumption.risk_id);
      if (!parentRisk) continue;
      const riskRank = rankedRisks.indexOf(parentRisk);
      if (riskRank > 4) {
        const unaddressedTop = rankedRisks
          .slice(0, 3)
          .filter((r) => !activeRiskIds.has(r.id));
        if (unaddressedTop.length > 0) {
          drift_warnings.push({
            severity: "warning",
            entity_type: "slice",
            entity_id: slice.id,
            message: `Slice ${slice.id} addresses ${parentRisk.id} (rank #${riskRank + 1}) while higher-priority risks remain untested: ${unaddressedTop.map((r) => r.id).join(", ")}.`,
          });
        }
      }
    }
  }

  // ─── Staleness Detection (Spec 3.4) ──────────────────────────────

  // Assumptions in "testing" with no completed slice
  for (const assumption of assumptions) {
    if (assumption.status !== "testing") continue;
    const completedSlices = slices.filter(
      (s) => s.assumption_id === assumption.id && s.status === "complete",
    );
    if (completedSlices.length === 0) {
      const days = daysSince(assumption.updated_date);
      if (days > 7) {
        staleness_warnings.push({
          severity: "warning",
          entity_type: "assumption",
          entity_id: assumption.id,
          message: `Assumption ${assumption.id} has been in "testing" for ${days} days with no signal captured.`,
          suggested_action: `Check on linked slices or escalate the blocked test.`,
        });
      }
    }
  }

  // Slices exceeding timebox
  for (const slice of slices) {
    if (slice.status !== "in_progress") continue;
    const timeboxDays = parseTimebox(slice.time_box);
    const elapsed = daysSince(slice.created_date);
    if (elapsed > timeboxDays * 1.5) {
      staleness_warnings.push({
        severity: "warning",
        entity_type: "slice",
        entity_id: slice.id,
        message: `Slice ${slice.id} has exceeded its timebox (${slice.time_box}). Elapsed: ${elapsed} days.`,
        suggested_action: `Complete, extend, or abandon this slice.`,
      });
    }
  }

  // ─── Risk Priority Ranking ───────────────────────────────────────

  const risk_priority_ranking: RiskPrioritySummary[] = rankedRisks.map((r) => ({
    risk_id: r.id,
    statement: r.statement,
    domain: r.domain,
    impact: r.impact,
    uncertainty: r.uncertainty,
    test_cost: r.test_cost,
    priority_score: r.computed_priority,
    has_assumptions: assumptions.some((a) => a.risk_id === r.id),
    active_slices: slices.filter((s) => {
      const asm = assumptions.find((a) => a.id === s.assumption_id);
      return asm?.risk_id === r.id && s.status === "in_progress";
    }).length,
  }));

  // ─── Overall Health ──────────────────────────────────────────────

  const hasCritical = state_inconsistencies.some((a) => a.severity === "critical");
  const hasGaps = gaps.length > 0 || drift_warnings.length > 0;
  const overall_evidence_health = hasCritical
    ? "critical_gaps" as const
    : hasGaps
      ? "gaps_present" as const
      : "healthy" as const;

  return {
    generated_at: new Date().toISOString(),
    gaps,
    drift_warnings,
    staleness_warnings,
    state_inconsistencies,
    risk_priority_ranking,
    overall_evidence_health,
  };
}
