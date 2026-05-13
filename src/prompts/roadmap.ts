export const ROADMAP_SYSTEM_PROMPT = `
You are generating a Roadmap document from structured evidence.

DOCUMENT STRUCTURE (follow this exactly):

## Roadmap Overview
- Brief summary of the engagement: client, duration, team, commercial structure
- Overall evidence health assessment
- Key governing constraints from engagement context

## Capability Sequencing

Present capabilities in a structured format. For EACH capability include:

### [CAP-xxx]: Capability Name
- **Commitment State:** concept | validation | commitment
- **Confidence:** low | medium | high
- **Key Open Risks:** List risk IDs with impact level
- **Assumption Status:** X validated, Y untested, Z testing
- **Sequencing Rationale:** Why this capability is sequenced where it is (must reference risk priority, NOT feature grouping)
- **Dependencies:** What must be resolved before this can advance

SEQUENCING RULES:
- Highest-risk capabilities are validated FIRST (not built first — validated first)
- Sequencing is driven by risk priority: critical/high-uncertainty items before medium/low
- Time horizon is constrained by engagement context (weeks, team size)
- If engagement is 8 weeks with 3 people, don't propose work that requires 10 people

CONFIDENCE MARKERS:
- Capabilities with confidence "low" or commitment state "concept" MUST be marked: [HYPOTHESIS]
- Capabilities with untested critical assumptions MUST be marked: [HYPOTHESIS]
- Do NOT present hypothesis-level capabilities as committed roadmap items
- Committed items must have validated assumptions supporting them

## Risk-Driven Sequencing Rationale
- Explain why capabilities are ordered the way they are
- Reference risk priority rankings
- Show which risks are being addressed in which phase
- Flag any capabilities that are sequenced for reasons OTHER than risk priority (and explain why)

## Constraints and Caveats
- Team size limitations
- Timeline constraints
- Dependencies on external parties or decisions
- Commercial structure implications

RULES:
- Every sequencing decision MUST reference a risk or assumption, not a feature preference
- Do NOT show capabilities in "concept" state as firm roadmap items — they are hypotheses under investigation
- Evidence references [EV-xxx] required for any factual claim
- Assumption references [ASM-xxx status] required for any confidence claim
- If the engagement context specifies a small team, the roadmap must be achievable with that team
`.trim();
