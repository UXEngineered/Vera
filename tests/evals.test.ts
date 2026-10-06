import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CASES, type RunKey, type RunOutcome } from "../evals/cases.ts";
import { checkDeliverable } from "../src/deliverables/check.ts";
import { DELIVERABLES, type DeliverableId } from "../src/deliverables/specs.ts";
import { parseEvidenceLog, profileEvidence } from "../src/evidence/validate.ts";

function outcome(key: RunKey, mutate?: (o: any) => void): RunOutcome {
  const [logName, d] = key.split(".") as [string, DeliverableId];
  const r = parseEvidenceLog(readFileSync(`examples/logs/${logName}.json`, "utf-8"));
  if (!r.ok) throw new Error("bad log");
  const out = JSON.parse(readFileSync(`tests/fixtures/${key}.golden.json`, "utf-8"));
  mutate?.(out);
  const profile = profileEvidence(r.log);
  const check = checkDeliverable(JSON.stringify(out), r.log, profile, DELIVERABLES[d]);
  return { key, log: r.log, profile, ok: check.ok, attempts: 1, deliverable: check.deliverable, issues: check.issues };
}
const run = (id: string, o: RunOutcome) => CASES.find((c) => c.id === id)!.assert(o);

test("there are 10–20 eval cases", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(10);
  expect(CASES.length).toBeLessThanOrEqual(20);
});

test("golden outputs pass the cases that apply to them", () => {
  for (const key of ["strong.strategy", "mixed.strategy", "thin.roadmap"] as RunKey[]) {
    const o = outcome(key);
    for (const c of CASES.filter((c) => c.runs.includes(key))) {
      expect({ case: c.id, failures: c.assert(o) }).toEqual({ case: c.id, failures: [] });
    }
  }
});

test("restraint case catches a confident thin roadmap", () => {
  const o = outcome("thin.roadmap", (out) => (out.sections[0].claims[0].action = "build"));
  expect(run("restraint.thin-roadmap", o).length).toBe(1);
});

test("strong-commits catches over-hedging", () => {
  const o = outcome("strong.strategy", (out) => {
    for (const s of out.sections) for (const c of s.claims) {
      c.confidence = "low";
      c.text = "Hypothesis to test: " + c.text.replace(/\bwill\b/g, "would");
    }
  });
  expect(run("confidence.strong-commits", o)[0]).toContain("over-hedging");
});

test("conflict case catches a dropped conflict", () => {
  const o = outcome("mixed.strategy", (out) => out.conflicts.shift());
  expect(run("conflict.surfaced", o)).toEqual(["EV-001 ↔ EV-002 not surfaced"]);
});
