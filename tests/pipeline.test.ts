import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DELIVERABLES } from "../src/deliverables/specs.ts";
import { parseEvidenceLog } from "../src/evidence/validate.ts";
import { ReplayProvider, type TraceRecord } from "../src/llm/index.ts";
import { generateDeliverable, type PipelineEvent } from "../src/pipeline/generate.ts";
import { completedArrayItems } from "../src/pipeline/partial.ts";

const r = parseEvidenceLog(readFileSync("examples/logs/thin.json", "utf-8"));
if (!r.ok) throw new Error("bad log");
const log = r.log;
const good = readFileSync("tests/fixtures/thin.roadmap.golden.json", "utf-8");
const bad = good.replace('"insufficient_evidence"', '"ready"');
const config = { max_tokens: 4000, timeout_ms: 5000, max_retries: 2 };

function harness(outputs: string[]) {
  const events: PipelineEvent[] = [];
  const traces: TraceRecord[] = [];
  const provider = new ReplayProvider(outputs);
  const run = generateDeliverable({
    log,
    spec: DELIVERABLES.roadmap,
    provider,
    config,
    trace: (t) => traces.push(t),
    onEvent: (e) => events.push(e),
  });
  return { run, events, traces };
}

describe("generateDeliverable", () => {
  test("passes on the first attempt and streams draft sections", async () => {
    const { run, events, traces } = harness([good]);
    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(events.filter((e) => e.type === "draft_section").length).toBe(3);
    expect(events.at(-1)!.type).toBe("done");
    expect(traces.length).toBe(1);
    expect(traces[0]!.prompt_versions).toEqual(["system.v1.md", "roadmap.v1.md"]);
    expect(traces[0]!.output).toBe(good);
  });

  test("retries with the failures fed back, then passes", async () => {
    const { run, events, traces } = harness([bad, good]);
    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    const retry = events.find((e) => e.type === "retry");
    expect(retry && retry.type === "retry" && retry.issues[0]!.check).toBe("restraint");
    const secondInput = traces[1]!.input.messages;
    expect(secondInput.length).toBe(3);
    expect(secondInput[2]!.content).toContain("overstates the evidence");
  });

  test("gives up after the retry cap and reports why", async () => {
    const { run, events } = harness([bad, bad, bad, good]);
    const result = await run;
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    if (!result.ok) expect(result.issues[0]!.check).toBe("restraint");
    expect(events.at(-1)!.type).toBe("failed");
  });
});

describe("completedArrayItems", () => {
  test("only returns elements that have fully arrived", () => {
    const partial = good.slice(0, good.indexOf('"id": "later"'));
    expect(completedArrayItems(partial, "sections").length).toBe(2);
    expect(completedArrayItems(good, "sections").length).toBe(3);
  });
  test("ignores brackets inside strings", () => {
    const text = '{"sections": [{"id": "a", "note": "x } ] {"}, {"id": "b"';
    expect(completedArrayItems(text, "sections")).toEqual([{ id: "a", note: "x } ] {" }]);
  });
});
