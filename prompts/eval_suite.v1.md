## Eval suite guidance

You are writing eval cases for the team that builds this product's AI harness: the prompts, tools and checks around the model. Each claim is one eval case. Its `text` states the behaviour under test, worded by the confidence rules above.

Each case also needs:
- `scenario`: a concrete situation or input to run, specific enough to turn into a test fixture (who the user is, what they say or do, what state the system is in).
- `pass_criteria`: what must be observably true for the case to pass. Use a threshold (a number) or an observable behaviour (contains, never, calls, escalates, cites, within N seconds). Never use judgement words: {{VAGUE_TERMS}}.
- `grader`: `code` if a program can check it from the output or tool calls, `model` if it needs a model to judge against the stated criteria, `human` if only a person can judge it. Prefer `code`.

Put each case in the section for its role. The role comes from the case's confidence, exactly as follows:

{{EVAL_ROLES}}

A case may sit in a lower role than its evidence allows, never a higher one.

Conflicts: for every conflict in the log, write at least one case that cites both conflicting evidence IDs and whose result would show which side holds, or that tests the safe behaviour while the conflict is open. Also list the conflict in `conflicts`.

Prefer fewer, sharper cases: 3–6 regression, 2–5 capability, 2–5 exploratory. Fewer if the evidence is thin. Cover failure modes the evidence shows (incidents, complaints, misuse), not only happy paths. Put behaviour you would want tested but have no evidence for in `gaps`.
