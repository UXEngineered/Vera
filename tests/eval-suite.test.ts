import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkMeasurable } from "../src/confidence/rules.ts";
import { checkDeliverable, type CheckKind } from "../src/deliverables/check.ts";
import { toEvalSuiteJson } from "../src/deliverables/export.ts";
import { buildPrompt } from "../src/deliverables/prompt.ts";
import { DELIVERABLES, PUBLIC_DELIVERABLES } from "../src/deliverables/specs.ts";
import { parseEvidenceLog, profileEvidence } from "../src/evidence/validate.ts";

const parsed = parseEvidenceLog(readFileSync("examples/logs/agent.json", "utf-8"));
if (!parsed.ok) throw new Error("agent sample is invalid");
const log = parsed.log;
const profile = profileEvidence(log);
const golden = () => JSON.parse(readFileSync("tests/fixtures/agent.eval_suite.golden.json", "utf-8"));
const check = (out: unknown, spec = DELIVERABLES.eval_suite) => checkDeliverable(JSON.stringify(out), log, profile, spec);
const kinds = (r: ReturnType<typeof check>): CheckKind[] => [...new Set(r.issues.map((i) => i.check))];

describe("support-agent sample log", () => {
  test("is partial with one conflict, where only the weaker side is contested", () => {
    expect(profile.readiness).toBe("partial");
    expect(profile.conflictPairs).toEqual([["EV-005", "EV-006"]]);
    expect(profile.contested).toEqual(["EV-005"]);
  });
});

describe("eval suite checks", () => {
  test("golden suite passes", () => {
    const r = check(golden());
    expect(r.issues).toEqual([]);
  });

  test("the compliance case can block release despite a weaker conflicting opinion", () => {
    const r = check(golden());
    const neverDecides = r.deliverable!.sections[0]!.claims[0]!;
    expect(neverDecides.evidence_ids).toEqual(["EV-006"]);
    expect(neverDecides.contested).toBe(false);
    expect(neverDecides.derived_confidence).toBe("high");
  });

  test("measurability: judgement words are rejected", () => {
    const out = golden();
    out.sections[0].claims[3].pass_criteria = "The agent answers claim-status questions correctly and in a helpful tone.";
    const r = check(out);
    expect(kinds(r)).toEqual(["measurability"]);
    expect(r.issues.map((i) => i.message).join(" ")).toContain('"correctly"');
  });

  test("measurability: criteria need a threshold or an observable behaviour", () => {
    expect(checkMeasurable("Customer feels reassured by the reply.")).toEqual(["names no threshold or observable behaviour"]);
    expect(checkMeasurable("Reply contains the claim reference.")).toEqual([]);
    expect(checkMeasurable("At least 90% of 50 replies.")).toEqual([]);
  });

  test("role: medium evidence cannot be a blocking regression case", () => {
    const out = golden();
    const medium = out.sections[1].claims.shift();
    medium.confidence = "medium";
    out.sections[0].claims.push(medium);
    const r = check(out);
    expect(kinds(r)).toEqual(["confidence"]);
    expect(r.issues[0]!.message).toContain("at most capability, not regression");
  });

  test("role: a well-evidenced case may sit in a lower role", () => {
    const out = golden();
    const high = out.sections[0].claims.pop();
    out.sections[1].claims.push(high);
    expect(check(out).ok).toBe(true);
  });

  test("conflict: needs a case citing both sides", () => {
    const out = golden();
    out.sections[2].claims[0].evidence_ids = ["EV-005"];
    const r = check(out);
    expect(kinds(r)).toEqual(["conflict"]);
    expect(r.issues[0]!.message).toContain("EV-005 and EV-006");
  });

  test("structure: every case needs scenario, pass criteria and grader", () => {
    const out = golden();
    delete out.sections[0].claims[0].grader;
    delete out.sections[0].claims[1].scenario;
    expect(check(out).issues.filter((i) => i.check === "structure").length).toBe(2);
  });

  test("structure: eval fields are rejected on other deliverables", () => {
    const strategy = JSON.parse(readFileSync("tests/fixtures/strong.strategy.golden.json", "utf-8"));
    strategy.sections[0].claims[0].grader = "code";
    const strong = parseEvidenceLog(readFileSync("examples/logs/strong.json", "utf-8"));
    if (!strong.ok) throw new Error("invalid");
    const r = checkDeliverable(JSON.stringify(strategy), strong.log, profileEvidence(strong.log), DELIVERABLES.strategy);
    expect(r.issues.map((i) => i.check)).toEqual(["structure"]);
  });
});

describe("plain JSON export", () => {
  const d = check(golden()).deliverable!;
  const meta = { model: "test", prompt_versions: ["system.v1.md", "eval_suite.v1.md"], run_id: "r1" };

  test("exports only approved sections, with edits applied and marked", () => {
    const review = {
      approved: { regression: "2026-10-06T10:00:00.000Z", exploratory: "2026-10-06T10:05:00.000Z" },
      edits: { "regression-2": "Quoted policy terms always come from the current wording." },
    };
    const out = toEvalSuiteJson(d, log, review, meta, new Date("2026-10-06T11:00:00Z"));
    expect(out.format).toBe("vera.eval_suite/1");
    expect(out.counts).toEqual({ regression: 5, capability: 0, exploratory: 2, blocking: 5, unapproved_sections: ["capability"] });
    const edited = out.cases.find((c) => c.id === "regression-2")!;
    expect(edited.behaviour).toBe("Quoted policy terms always come from the current wording.");
    expect(edited.edited).toBe(true);
    expect(out.cases.every((c) => c.blocking === (c.role === "regression"))).toBe(true);
    expect(out.cases[0]!.evidence[0]).toEqual({ id: "EV-006", source_type: "stakeholder", summary: log.items[5]!.summary, confidence: "high" });
  });

  test("nothing is exported before approval", () => {
    expect(toEvalSuiteJson(d, log, { approved: {}, edits: {} }, meta).cases).toEqual([]);
  });

  test("refuses other deliverables", () => {
    expect(() => toEvalSuiteJson({ ...d, deliverable: "strategy" }, log, { approved: {}, edits: {} }, meta)).toThrow();
  });
});

describe("prompt and visibility", () => {
  test("every deliverable prompt renders with no placeholders left", () => {
    for (const spec of Object.values(DELIVERABLES)) {
      const p = buildPrompt(spec, log, profile);
      expect({ id: spec.id, leftover: (p.system + p.user).match(/\{\{\w+\}\}/g) }).toEqual({ id: spec.id, leftover: null });
    }
  });

  test("eval suite prompt lists the role table and the contested ids", () => {
    const p = buildPrompt(DELIVERABLES.eval_suite, log, profile);
    expect(p.system).toContain("HIGH confidence → `regression`");
    expect(p.user).toContain("Contested (claims citing these are at most medium): EV-005");
  });

  test("eval suite stays out of the public demo until a live run passes", () => {
    expect(PUBLIC_DELIVERABLES.map((d) => d.id)).toEqual(["strategy", "roadmap"]);
  });
});
