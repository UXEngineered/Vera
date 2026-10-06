import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseEvidenceLog, profileEvidence, validateEvidenceLog } from "../src/evidence/validate.ts";

const load = (name: string) => readFileSync(`examples/logs/${name}.json`, "utf-8");

describe("sample logs", () => {
  for (const name of ["strong", "mixed", "thin"]) {
    test(`${name}.json is valid`, () => {
      const result = parseEvidenceLog(load(name));
      if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
      expect(result.ok).toBe(true);
    });
  }

  test("profiles map to the intended readiness", () => {
    const readiness = (name: string) => {
      const r = parseEvidenceLog(load(name));
      if (!r.ok) throw new Error("invalid");
      return profileEvidence(r.log).readiness;
    };
    expect(readiness("strong")).toBe("ready");
    expect(readiness("mixed")).toBe("partial");
    expect(readiness("thin")).toBe("insufficient_evidence");
  });

  test("mixed log conflicts are de-duplicated into pairs", () => {
    const r = parseEvidenceLog(load("mixed"));
    if (!r.ok) throw new Error("invalid");
    expect(profileEvidence(r.log).conflictPairs).toEqual([
      ["EV-001", "EV-002"],
      ["EV-004", "EV-005"],
    ]);
  });
});

describe("contested evidence", () => {
  test("a weaker item cannot demote a stronger one", () => {
    const r = parseEvidenceLog(load("mixed"));
    if (!r.ok) throw new Error("invalid");
    // EV-001 (medium) vs EV-002 (high): only EV-001 is contested.
    // EV-004 (medium) vs EV-005 (low): only EV-005 is contested.
    expect(profileEvidence(r.log).contested).toEqual(["EV-001", "EV-005"]);
  });

  test("equally strong items contest each other", () => {
    const log = JSON.parse(load("strong"));
    log.items[0].conflicts_with = ["EV-002"];
    const r = validateEvidenceLog(log);
    if (!r.ok) throw new Error("invalid");
    expect(profileEvidence(r.log).contested).toEqual(["EV-001", "EV-002"]);
  });
});

describe("bad input fails clearly", () => {
  const base = () => JSON.parse(load("thin"));

  test("not JSON", () => {
    const r = parseEvidenceLog("{ nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.message).toContain("not valid JSON");
  });

  test("bad confidence names the item", () => {
    const log = base();
    log.items[1].confidence = "very high";
    const r = validateEvidenceLog(log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.path).toBe("items[1] (EV-002).confidence");
  });

  test("unknown keys are rejected", () => {
    const log = base();
    log.items[0].confidance = "high";
    expect(validateEvidenceLog(log).ok).toBe(false);
  });

  test("duplicate ids", () => {
    const log = base();
    log.items[2].id = "EV-001";
    const r = validateEvidenceLog(log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message)).toContain("duplicate evidence id EV-001");
  });

  test("conflicts_with must reference a real item", () => {
    const log = base();
    log.items[0].conflicts_with = ["EV-099"];
    const r = validateEvidenceLog(log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.message).toContain("unknown evidence id EV-099");
  });

  test("missing required fields", () => {
    const log = base();
    delete log.items[0].summary;
    delete log.items[0].date;
    const r = validateEvidenceLog(log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBe(2);
  });

  test("bad date and id formats", () => {
    const log = base();
    log.items[0].date = "last tuesday";
    log.items[0].id = "evidence-1";
    expect(validateEvidenceLog(log).ok).toBe(false);
  });
});
