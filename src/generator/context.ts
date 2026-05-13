import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceStore } from "../store/types.ts";

/**
 * Build a comprehensive evidence context string for LLM artifact generation.
 * Packages the entire evidence store into structured text.
 */
export async function buildEvidenceContext(store: EvidenceStore): Promise<string> {
  const [context, evidence, risks, assumptions, slices, capabilities, decisions] =
    await Promise.all([
      store.getContext(),
      store.listEvidence(),
      store.listRisks(),
      store.listAssumptions(),
      store.listSlices(),
      store.listCapabilities(),
      store.listDecisions(),
    ]);

  const sections: string[] = [];

  // Engagement context document (rich narrative context if available)
  const engagementContextPath = join(store.basePath, "engagement-context.md");
  try {
    const engagementContext = await readFile(engagementContextPath, "utf-8");
    sections.push(`## ENGAGEMENT CONTEXT (DETAILED)\n\n${engagementContext}`);
  } catch {
    // No engagement context file — fall through to structured context below
  }

  // Engagement context
  if (context) {
    sections.push(`## ENGAGEMENT CONTEXT
- Client: ${context.client_name}
- Duration: ${context.duration_weeks} weeks (current week: ${context.current_week})
- Team: ${context.team.length > 0 ? context.team.map((t) => `${t.name} (${t.role}, ${t.allocation}%)`).join(", ") : "Not specified"}
- Delivery cadence: ${context.delivery_cadence}
- Commercial structure: ${context.commercial_structure}
- Client constraints: ${context.client_constraints.length > 0 ? context.client_constraints.join("; ") : "None specified"}
- Required deliverables: ${context.deliverables_required.length > 0 ? context.deliverables_required.join("; ") : "None specified"}
- Start date: ${context.start_date}`);
  }

  // Capabilities
  if (capabilities.length > 0) {
    const capLines = capabilities.map((c) => {
      const capRisks = risks.filter((r) => r.capability_id === c.id);
      const capAssumptions = assumptions.filter((a) => a.capability_id === c.id);
      const validated = capAssumptions.filter((a) => a.status === "validated").length;
      const untested = capAssumptions.filter((a) => a.status === "untested").length;
      return `### ${c.id}: ${c.name}
- Description: ${c.description}
- Commitment state: ${c.commitment_state}
- Confidence: ${c.confidence}
- Linked risks: ${capRisks.map((r) => r.id).join(", ") || "none"}
- Assumptions: ${capAssumptions.length} total (${validated} validated, ${untested} untested)`;
    });
    sections.push(`## CAPABILITIES\n${capLines.join("\n\n")}`);
  }

  // Evidence entries
  if (evidence.length > 0) {
    const evLines = evidence.map(
      (e) =>
        `- **${e.id}** [${e.type}] (${e.domain}) — Source: ${e.source} (${e.date})
  "${e.content}"${e.capability_id ? ` → ${e.capability_id}` : ""}${e.tags.length > 0 ? ` | Tags: ${e.tags.join(", ")}` : ""}`,
    );
    sections.push(`## EVIDENCE ENTRIES (${evidence.length} total)\n${evLines.join("\n")}`);
  }

  // Risks
  if (risks.length > 0) {
    const riskLines = risks.map(
      (r) =>
        `### ${r.id} [${r.status}] — ${r.domain} domain
- Statement: "${r.statement}"
- Impact: ${r.impact} | Uncertainty: ${r.uncertainty} | Test cost: ${r.test_cost}
- Capability: ${r.capability_id}
- Priority score: ${r.priority_score ?? "not computed"}
- Linked assumptions: ${r.assumptions.length > 0 ? r.assumptions.join(", ") : "none"}`,
    );
    sections.push(`## RISKS (${risks.length} total)\n${riskLines.join("\n\n")}`);
  }

  // Assumptions
  if (assumptions.length > 0) {
    const asmLines = assumptions.map(
      (a) =>
        `### ${a.id} [${a.status}] — ${a.domain} domain (confidence: ${a.confidence})
- Risk: ${a.risk_id} | Capability: ${a.capability_id}
- Statement: "${a.statement}"
- Success criteria: ${a.success_criteria}
- Failure criteria: ${a.failure_criteria}
- Decision consequence: ${a.decision_consequence}
- Linked evidence: ${a.linked_evidence.length > 0 ? a.linked_evidence.join(", ") : "none"}
- Linked slices: ${a.linked_slices.length > 0 ? a.linked_slices.join(", ") : "none"}`,
    );
    sections.push(`## ASSUMPTIONS (${assumptions.length} total)\n${asmLines.join("\n\n")}`);
  }

  // Slices
  if (slices.length > 0) {
    const sliceLines = slices.map(
      (s) =>
        `- **${s.id}** [${s.status}] — ${s.type}: "${s.description}"
  Assumption: ${s.assumption_id} | Timebox: ${s.time_box}
  Success: ${s.signal_definition.success} | Failure: ${s.signal_definition.failure}${s.signal_captured ? `\n  Signal captured: ${s.signal_captured}` : ""}`,
    );
    sections.push(`## SLICES (${slices.length} total)\n${sliceLines.join("\n")}`);
  }

  // Decisions
  if (decisions.length > 0) {
    const decLines = decisions.map(
      (d) =>
        `- **${d.id}** [${d.type}] — ${d.date} by ${d.made_by}
  Rationale: "${d.rationale}"${d.assumption_id ? ` | Assumption: ${d.assumption_id}` : ""}${d.capability_id ? ` | Capability: ${d.capability_id}` : ""}`,
    );
    sections.push(`## DECISIONS (${decisions.length} total)\n${decLines.join("\n")}`);
  }

  // Domain coverage summary
  const domains = ["value", "usability", "feasibility", "viability", "operational"];
  const coverage = domains.map((d) => {
    const count = evidence.filter((e) => e.domain === d).length;
    return `- ${d}: ${count === 0 ? "⚠️ NO EVIDENCE" : `${count} entries`}`;
  });
  sections.push(`## DOMAIN COVERAGE\n${coverage.join("\n")}`);

  return sections.join("\n\n---\n\n");
}
