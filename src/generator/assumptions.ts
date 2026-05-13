import type { EvidenceStore } from "../store/types.ts";
import type { Risk, CandidateAssumption, RiskDomain } from "../schema/index.ts";
import { generateJson } from "./llm.ts";

const ASSUMPTION_SYSTEM_PROMPT = `
You are generating testable assumptions for a product risk.

RULES:
- Each assumption must be a specific, declarative, testable statement
- Each assumption must be measurable — define what "true" looks like
- Each assumption must be behavioral where possible
- Each assumption must test ONE variable
- Do NOT generate vague statements like "this will work" or "users will like it"
- Do NOT generate assumptions that cannot be tested within 2 weeks
- Generate 2-4 candidate assumptions per risk
- For each assumption, include: statement, success_criteria, failure_criteria, decision_consequence

BAD EXAMPLE:
  statement: "The onboarding will be good"
  → Too vague. Not testable. No measurable criteria.

GOOD EXAMPLE:
  statement: "Users will complete onboarding in under 2 minutes without guidance"
  success_criteria: "≥70% of test users complete in under 2 minutes"
  failure_criteria: "<50% complete in under 2 minutes"
  decision_consequence: "If validated, onboarding flow moves to Commitment. If invalidated, redesign required before scaling."

Return a JSON array of objects with these fields:
- statement (string)
- success_criteria (string)
- failure_criteria (string)
- decision_consequence (string)

Return ONLY the JSON array, no other text.
`.trim();

interface RawCandidate {
  statement: string;
  success_criteria: string;
  failure_criteria: string;
  decision_consequence: string;
}

export async function generateCandidateAssumptions(
  store: EvidenceStore,
  riskId: string,
  model: string = "claude-opus-4-5",
): Promise<CandidateAssumption[]> {
  const risk = await store.getRisk(riskId);
  if (!risk) throw new Error(`Risk ${riskId} not found`);

  const capability = await store.getCapability(risk.capability_id);
  const existingAssumptions = await store.listAssumptions({ risk_id: riskId });
  const evidence = await store.listEvidence({ capability_id: risk.capability_id });

  const userPrompt = buildUserPrompt(risk, capability, existingAssumptions, evidence);
  const candidates = await generateJson<RawCandidate[]>(
    ASSUMPTION_SYSTEM_PROMPT,
    userPrompt,
    model,
  );

  const results: CandidateAssumption[] = [];
  for (const raw of candidates) {
    const saved = await store.addCandidate({
      statement: raw.statement,
      domain: risk.domain,
      success_criteria: raw.success_criteria,
      failure_criteria: raw.failure_criteria,
      decision_consequence: raw.decision_consequence,
      risk_id: riskId,
      capability_id: risk.capability_id,
      status: "candidate",
    });
    results.push(saved);
  }

  return results;
}

function buildUserPrompt(
  risk: Risk,
  capability: any,
  existingAssumptions: any[],
  evidence: any[],
): string {
  let prompt = `## RISK\n`;
  prompt += `- ID: ${risk.id}\n`;
  prompt += `- Statement: "${risk.statement}"\n`;
  prompt += `- Domain: ${risk.domain}\n`;
  prompt += `- Impact: ${risk.impact}\n`;
  prompt += `- Uncertainty: ${risk.uncertainty}\n`;

  if (capability) {
    prompt += `\n## CAPABILITY\n`;
    prompt += `- ID: ${capability.id}\n`;
    prompt += `- Name: ${capability.name}\n`;
    prompt += `- Description: ${capability.description}\n`;
    prompt += `- State: ${capability.commitment_state}\n`;
  }

  if (existingAssumptions.length > 0) {
    prompt += `\n## EXISTING ASSUMPTIONS (do not duplicate these)\n`;
    for (const a of existingAssumptions) {
      prompt += `- ${a.id}: "${a.statement}" [${a.status}]\n`;
    }
  }

  if (evidence.length > 0) {
    prompt += `\n## RELATED EVIDENCE\n`;
    for (const e of evidence) {
      prompt += `- ${e.id} [${e.type}]: "${e.content}"\n`;
    }
  }

  prompt += `\nGenerate 2-4 testable candidate assumptions for this risk. Return JSON array only.`;
  return prompt;
}
