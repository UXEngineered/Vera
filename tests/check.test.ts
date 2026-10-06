import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkDeliverable, type CheckKind } from "../src/deliverables/check.ts";
import { DELIVERABLES, type DeliverableId } from "../src/deliverables/specs.ts";
import { parseEvidenceLog, profileEvidence } from "../src/evidence/validate.ts";
import { checkLanguage, deriveClaimConfidence } from "../src/confidence/rules.ts";

function setup(logName: string) {
  const r = parseEvidenceLog(readFileSync(`examples/logs/${logName}.json`, "utf-8"));
  if (!r.ok) throw new Error("bad sample log");
  return { log: r.log, profile: profileEvidence(r.log) };
}
const golden = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.golden.json`, "utf-8"));

function run(logName: string, deliverable: DeliverableId, output: unknown) {
  const { log, profile } = setup(logName);
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return checkDeliverable(text, log, profile, DELIVERABLES[deliverable]);
}
const kinds = (r: ReturnType<typeof run>): CheckKind[] => [...new Set(r.issues.map((i) => i.check))];

describe("golden outputs pass every check", () => {
  for (const [log, d] of [["strong", "strategy"], ["mixed", "strategy"], ["thin", "roadmap"]] as const) {
    test(`${log} ${d}`, () => {
      const r = run(log, d, golden(`${log}.${d}`));
      expect(r.issues).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }

  test("claims get stable ids and derived confidence", () => {
    const r = run("mixed", "strategy", golden("mixed.strategy"));
    const claim = r.deliverable!.sections[1]!.claims[0]!;
    expect(claim.id).toBe("opportunity-1");
    expect(claim.derived_confidence).toBe("medium");
    const contested = r.deliverable!.sections[0]!.claims[1]!;
    expect(contested.contested).toBe(true);
  });

  test("tolerates code fences around the JSON", () => {
    const r = run("strong", "strategy", "```json\n" + JSON.stringify(golden("strong.strategy")) + "\n```");
    expect(r.ok).toBe(true);
  });
});

describe("each check catches its failure", () => {
  test("schema: not JSON", () => {
    expect(kinds(run("strong", "strategy", "Here is your strategy!"))).toEqual(["schema"]);
  });

  test("schema: claim without citations", () => {
    const out = golden("strong.strategy");
    out.sections[0].claims[0].evidence_ids = [];
    expect(kinds(run("strong", "strategy", out))).toEqual(["schema"]);
  });

  test("traceability: invented evidence id", () => {
    const out = golden("strong.strategy");
    out.sections[0].claims[0].evidence_ids.push("EV-042");
    const r = run("strong", "strategy", out);
    expect(kinds(r)).toEqual(["traceability"]);
    expect(r.issues[0]!.message).toContain("EV-042");
  });

  test("confidence: label higher than evidence supports", () => {
    const out = golden("strong.strategy");
    out.sections[2].claims[2].confidence = "high"; // cites medium evidence
    expect(kinds(run("strong", "strategy", out))).toContain("confidence");
  });

  test("confidence: committed language on low evidence", () => {
    const out = golden("thin.roadmap");
    out.sections[0].claims[0].text = "Hypothesis to test: AI will halve review time.";
    const r = run("thin", "roadmap", out);
    expect(kinds(r)).toEqual(["confidence"]);
    expect(r.issues[0]!.message).toContain('"will"');
  });

  test("confidence: low claim missing hypothesis framing", () => {
    const out = golden("thin.roadmap");
    out.sections[0].claims[0].text = "Associates spend a third of their week on review.";
    expect(kinds(run("thin", "roadmap", out))).toEqual(["confidence"]);
  });

  test("confidence: contested evidence cannot be committed", () => {
    const out = golden("mixed.strategy");
    out.sections[0].claims[1] = { text: "Price is why customers leave.", evidence_ids: ["EV-004"], confidence: "high" };
    expect(kinds(run("mixed", "strategy", out))).toContain("confidence");
  });

  test("confidence: low evidence cannot be a build item", () => {
    const out = golden("thin.roadmap");
    out.sections[0].claims[0].action = "build";
    expect(kinds(run("thin", "roadmap", out))).toEqual(["confidence"]);
  });

  test("conflict: unsurfaced conflict", () => {
    const out = golden("mixed.strategy");
    out.conflicts.pop();
    const r = run("mixed", "strategy", out);
    expect(kinds(r)).toEqual(["conflict"]);
    expect(r.issues[0]!.message).toContain("EV-004 and EV-005");
  });

  test("restraint: overstated readiness", () => {
    const out = golden("thin.roadmap");
    out.readiness = "ready";
    expect(kinds(run("thin", "roadmap", out))).toEqual(["restraint"]);
  });

  test("restraint: thin log needs at least 3 gaps", () => {
    const out = golden("thin.roadmap");
    out.gaps = out.gaps.slice(0, 1);
    expect(kinds(run("thin", "roadmap", out))).toEqual(["restraint"]);
  });

  test("structure: missing section and empty section without note", () => {
    const out = golden("thin.roadmap");
    out.sections.pop();
    delete out.sections[1].note;
    const r = run("thin", "roadmap", out);
    expect(r.issues.filter((i) => i.check === "structure").length).toBe(2);
  });

  test("structure: roadmap items need an action", () => {
    const out = golden("thin.roadmap");
    delete out.sections[0].claims[0].action;
    expect(kinds(run("thin", "roadmap", out))).toEqual(["structure"]);
  });
});

describe("confidence rules", () => {
  test("claim confidence is the weakest cited evidence", () => {
    expect(deriveClaimConfidence([{ confidence: "high", contested: false }, { confidence: "low", contested: false }])).toBe("low");
  });
  test("contested evidence caps at medium", () => {
    expect(deriveClaimConfidence([{ confidence: "high", contested: true }])).toBe("medium");
  });
  test("whole-word matching avoids false positives", () => {
    expect(checkLanguage("Hypothesis to test: willingness to pay is low", "low")).toEqual([]);
  });
  test("high confidence has no language restriction", () => {
    expect(checkLanguage("This will work.", "high")).toEqual([]);
  });
});
