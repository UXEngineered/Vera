export const CONFIDENCE_LANGUAGE_RULES = `
CONFIDENCE LANGUAGE RULES — NON-NEGOTIABLE:

When referencing HIGH confidence items (assumption status "validated", capability confidence "high"):
- Use definitive language: "The system should...", "This capability will...", "Evidence confirms..."
- Include evidence reference in brackets: [EV-xxx]

When referencing MEDIUM confidence items (assumption status "conditional" or "testing", capability confidence "medium"):
- Use directional language: "Evidence suggests...", "Likely direction is...", "Current testing indicates..."
- Include evidence reference AND note what would change the assessment
- Example: "Evidence suggests users prefer push notifications [EV-006], though this requires further validation through ASM-003."

When referencing LOW confidence items (assumption status "untested", capability confidence "low"):
- Use hypothesis language: "Current hypothesis is...", "Requires validation...", "Unvalidated assumption..."
- Include what evidence is needed to increase confidence
- Example: "Hypothesis: users will complete onboarding in under 2 minutes. No evidence yet — requires usability testing [ASM-002 untested]."

When evidence is INSUFFICIENT or a domain has zero coverage:
- State explicitly: "Evidence insufficient to recommend. Open risk requiring investigation."
- Do NOT fill the gap with plausible-sounding content
- Do NOT use weasel words to mask the gap
- Example: "No evidence exists for the viability domain. Business model risk is completely unexamined."

ANTI-PATTERN CHECK — apply to every definitive statement you write:
- If you wrote "The system should..." or "This will..." → check: is the linked assumption validated?
- If the assumption is "untested" or "testing" → rewrite using hedge language
- If there is no linked assumption at all → rewrite as explicit gap

CITATION RULES:
- Every factual claim must include at least one evidence reference in brackets: [EV-xxx]
- Every assumption reference must include its status: [ASM-xxx validated] or [ASM-xxx untested]
- Every capability reference must include its commitment state: [CAP-xxx concept] or [CAP-xxx commitment]
- If you cannot cite a specific evidence entry for a claim, do not make the claim

FORMATTING:
- Use markdown formatting
- Use headers (##) for major sections
- Use bullet points for lists
- Use bold for emphasis on key findings
- Use blockquotes (>) for direct evidence citations
`.trim();
