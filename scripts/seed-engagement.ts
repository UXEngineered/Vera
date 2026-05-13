#!/usr/bin/env bun
/**
 * Seed VERA evidence store from real engagement data:
 * - Product Risks CSV
 * - Evidence Ledger CSV
 * - Jira Tasks CSV
 *
 * Usage: bun run scripts/seed-engagement.ts
 */

import { readFile } from "fs/promises";
import { parse } from "csv-parse/sync";
import { JsonEvidenceStore } from "../src/store/json-store.ts";
import { resolveStorePath, resolveArtifactsPath, saveConfig, defaultConfig } from "../src/config.ts";
import { mkdir } from "fs/promises";
import { now, today } from "../src/utils.ts";
import chalk from "chalk";

// ─── File Paths ────────────────────────────────────────────────────────────

const RISKS_CSV = `${process.env.HOME}/Downloads/Evidence Work Operating Kit - PRODUCT RISKS.csv`;
const EVIDENCE_CSV = `${process.env.HOME}/Downloads/Evidence Work Operating Kit - EVIDENCE LEDGER.csv`;
const JIRA_CSV = `${process.env.HOME}/Downloads/jira-tasks.csv`;

// ─── CSV Parsing ───────────────────────────────────────────────────────────

function parseCsv(content: string): Record<string, string>[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

function get(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    for (const [k, v] of Object.entries(row)) {
      if (k.trim().toLowerCase().replace(/[\s_-]+/g, "") === key.toLowerCase().replace(/[\s_-]+/g, "")) {
        if (v?.trim()) return v.trim();
      }
    }
  }
  return "";
}

// ─── Domain Mapping ────────────────────────────────────────────────────────

function mapDomain(riskType: string): "value" | "usability" | "feasibility" | "viability" | "operational" {
  const t = riskType.toLowerCase().trim();
  if (t.includes("feasib")) return "feasibility";
  if (t.includes("oper")) return "operational";
  if (t.includes("value") || t.includes("val")) return "value";
  if (t.includes("usab")) return "usability";
  if (t.includes("viab")) return "viability";
  return "feasibility"; // default for untyped
}

function mapImpact(collapse: string): "critical" | "high" | "medium" | "low" {
  const c = collapse.toLowerCase().trim();
  if (c === "high") return "high";
  if (c === "medium") return "medium";
  if (c === "low") return "low";
  if (c === "critical") return "critical";
  return "medium";
}

function mapUncertainty(u: string): "high" | "medium" | "low" {
  const v = u.toLowerCase().trim();
  if (v === "high") return "high";
  if (v === "low") return "low";
  return "medium";
}

function mapRiskStatus(status: string): "open" | "mitigated" | "accepted" | "closed" {
  const s = status.toLowerCase().trim();
  if (s === "completed") return "mitigated";
  if (s === "in progress") return "open";
  if (s === "not needed") return "accepted";
  if (s === "decision gate") return "open";
  return "open";
}

function mapEvidenceStatus(status: string): "untested" | "testing" | "validated" | "invalidated" | "conditional" {
  const s = status.toLowerCase().trim();
  if (s === "validated") return "validated";
  if (s === "partially validated") return "conditional";
  if (s === "not validated") return "invalidated";
  if (s === "in progress") return "testing";
  return "untested";
}

function mapConfidence(conf: string): "low" | "medium" | "high" {
  const c = conf.toLowerCase().trim();
  if (c === "high") return "high";
  if (c === "medium") return "medium";
  return "low";
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.white.bold("\nVERA — Seeding Evidence Store from Engagement Data\n"));

  // Read all CSVs
  const [risksRaw, evidenceRaw, jiraRaw] = await Promise.all([
    readFile(RISKS_CSV, "utf-8"),
    readFile(EVIDENCE_CSV, "utf-8"),
    readFile(JIRA_CSV, "utf-8"),
  ]);

  const riskRows = parseCsv(risksRaw);
  const evidenceRows = parseCsv(evidenceRaw);
  const jiraRows = parseCsv(jiraRaw);

  console.log(`  Risks CSV:    ${riskRows.length} rows`);
  console.log(`  Evidence CSV: ${evidenceRows.length} rows`);
  console.log(`  Jira CSV:     ${jiraRows.length} rows`);
  console.log();

  // Initialize store
  const storePath = resolveStorePath();
  const artifactsPath = resolveArtifactsPath();
  const store = new JsonEvidenceStore(storePath);

  await store.initialize({
    engagement_id: "engagement-001",
    client_name: "Discovery Engagement",
    duration_weeks: 8,
    team: [
      { name: "James Williams", role: "Product Lead", allocation: 100 },
      { name: "Ricky Caldwell", role: "Engineering Lead", allocation: 100 },
      { name: "Nicolas Falcon", role: "Engineer", allocation: 100 },
      { name: "Joe Dallacqua", role: "Engineer", allocation: 100 },
      { name: "Luis Argüello", role: "Operations", allocation: 100 },
      { name: "Toyia Smith", role: "Operations", allocation: 100 },
      { name: "Marcelle Carlson", role: "Designer", allocation: 100 },
    ],
    delivery_cadence: "weekly sprint",
    commercial_structure: "Fixed SOW",
    client_constraints: [
      "iPad-based deployment required",
      "AR capabilities must work outdoors",
      "30-minute sales session target",
      "Phase 1 demo scope constraints",
    ],
    deliverables_required: [
      "Product Strategy",
      "Roadmap",
      "Scope Check",
      "Technical Architecture Recommendations",
      "Risk Assessment",
      "Build Phase Estimation",
    ],
    start_date: "2026-02-24",
    current_week: 7,
  });

  await mkdir(`${artifactsPath}/current`, { recursive: true });
  await mkdir(`${artifactsPath}/history`, { recursive: true });
  await saveConfig(defaultConfig());

  console.log(chalk.green("  ✓ Evidence store initialized\n"));

  // ─── Step 1: Extract Capabilities ──────────────────────────────────

  console.log(chalk.white.bold("Step 1: Capabilities"));

  // Canonical capability names — deduplicate similar names
  const CANONICAL_NAMES: Record<string, string> = {
    "session persistence & retrieval": "Session Persistence & Retrieval",
    "session persistence and retrieval": "Session Persistence & Retrieval",
    "device support definition": "Supported Device Definition",
    "supported device definition": "Supported Device Definition",
    "stable ar visualization": "Stable AR Visualization",
  };

  function canonicalize(name: string): string {
    return CANONICAL_NAMES[name.toLowerCase()] || name;
  }

  const capabilityNames = new Set<string>();

  // From risks CSV
  for (const row of riskRows) {
    const capName = get(row, "Capabilities[EPICS]", "Capabilities");
    if (capName) capabilityNames.add(canonicalize(capName));
  }

  // From evidence CSV
  for (const row of evidenceRows) {
    const capName = get(row, "Capability");
    if (capName) capabilityNames.add(canonicalize(capName));
  }

  // From jira epics
  for (const row of jiraRows) {
    if (get(row, "IssueType", "Issue Type") === "Capability [epic]") {
      const name = get(row, "Summary");
      if (name && !name.startsWith("EV:") && name !== "Experience" && name !== "Operations") {
        capabilityNames.add(canonicalize(name.replace("EV: ", "")));
      }
    }
  }

  const capNameToId = new Map<string, string>();

  // Determine commitment state based on evidence data
  const capConfidence = new Map<string, { validated: number; total: number }>();
  for (const row of evidenceRows) {
    const capName = get(row, "Capability");
    if (!capName) continue;
    if (!capConfidence.has(capName)) capConfidence.set(capName, { validated: 0, total: 0 });
    const entry = capConfidence.get(capName)!;
    entry.total++;
    const status = get(row, "Status");
    if (status.toLowerCase().includes("validated")) entry.validated++;
  }

  for (const name of capabilityNames) {
    const conf = capConfidence.get(name);
    let commitmentState: "concept" | "validation" | "commitment" = "concept";
    let confidence: "low" | "medium" | "high" = "low";

    if (conf) {
      const ratio = conf.validated / conf.total;
      if (ratio >= 0.8 && conf.total >= 3) {
        commitmentState = "commitment";
        confidence = "high";
      } else if (ratio >= 0.5 || conf.total >= 2) {
        commitmentState = "validation";
        confidence = "medium";
      } else if (conf.total >= 1) {
        commitmentState = "validation";
        confidence = "low";
      }
    }

    const cap = await store.addCapability({
      name,
      description: `${name} capability`,
      commitment_state: commitmentState,
      confidence,
      assumptions: [],
      risks: [],
      promotion_history: [],
    });
    capNameToId.set(name, cap.id);
    capNameToId.set(name.toLowerCase(), cap.id);
    // Also map alternate names
    for (const [alt, canonical] of Object.entries(CANONICAL_NAMES)) {
      if (canonical === name) capNameToId.set(alt, cap.id);
    }
    console.log(`  ${chalk.green(cap.id)}: ${name} (${commitmentState}, ${confidence})`);
  }
  console.log();

  // ─── Step 2: Import Risks ──────────────────────────────────────────

  console.log(chalk.white.bold("Step 2: Risks"));

  const riskStatementToId = new Map<string, string>();

  for (const row of riskRows) {
    const riskStatement = get(row, "Risk");
    const clarifier = get(row, "Clarifier");
    if (!riskStatement) continue;

    const riskType = get(row, "RiskType", "Risk Type");
    const collapse = get(row, "CollapseLevel", "Collapse Level");
    const uncertainty = get(row, "Uncertainty");
    const testEffort = get(row, "TestEffort", "Test Effort");
    const status = get(row, "Status");
    const capName = get(row, "Capabilities[EPICS]", "Capabilities");
    const phase = get(row, "Phase");

    const resolvedCapName = capName ? canonicalize(capName) : "";
    const capId = resolvedCapName ? (capNameToId.get(resolvedCapName) || capNameToId.get(resolvedCapName.toLowerCase()) || "UNKNOWN") : "UNKNOWN";

    const fullStatement = clarifier
      ? `${riskStatement}: ${clarifier}`
      : riskStatement;

    const risk = await store.addRisk({
      statement: fullStatement,
      domain: mapDomain(riskType),
      capability_id: capId,
      impact: mapImpact(collapse),
      uncertainty: mapUncertainty(uncertainty),
      test_cost: mapImpact(testEffort || "medium"),
      status: mapRiskStatus(status),
      assumptions: [],
    });

    riskStatementToId.set(riskStatement.toLowerCase().slice(0, 60), risk.id);
    // Also map by short key phrases
    const words = riskStatement.toLowerCase().split(/\s+/).slice(0, 5).join(" ");
    riskStatementToId.set(words, risk.id);

    const statusLabel = risk.status === "open" ? chalk.yellow("open") : chalk.dim(risk.status);
    console.log(`  ${chalk.green(risk.id)}: ${riskStatement.slice(0, 70)}... (${statusLabel})`);
  }
  console.log();

  // ─── Step 3: Import Evidence + Assumptions from Evidence Ledger ────

  console.log(chalk.white.bold("Step 3: Evidence Entries + Assumptions"));

  for (const row of evidenceRows) {
    const evidenceId = get(row, "EvidenceID/Jira#", "Evidence ID/Jira #", "EvidenceID");
    const capName = get(row, "Capability");
    const riskName = get(row, "Risk");
    const assumptionText = get(row, "Assumption");
    const testScope = get(row, "TestScope", "Test Scope");
    const signal = get(row, "Signal");
    const startConf = get(row, "StartingConfidence", "Starting Confidence");
    const currentConf = get(row, "CurrentConfidence", "Current Confidence");
    const status = get(row, "Status");
    const limitations = get(row, "Limitations/NotYetTested", "Limitations/Not Yet Tested");
    const nextStep = get(row, "NextEvidenceStep", "Next Evidence Step");

    if (!assumptionText && !signal) continue;

    const resolvedEvCapName = capName ? canonicalize(capName) : "";
    const capId = resolvedEvCapName ? (capNameToId.get(resolvedEvCapName) || capNameToId.get(resolvedEvCapName.toLowerCase()) || "UNKNOWN") : "UNKNOWN";

    // Resolve risk ID
    let riskId = "UNKNOWN";
    if (riskName) {
      const riskKey = riskName.toLowerCase().slice(0, 60);
      for (const [key, id] of riskStatementToId) {
        if (key.includes(riskKey.slice(0, 30)) || riskKey.includes(key.slice(0, 30))) {
          riskId = id;
          break;
        }
      }
      // Try shorter match
      if (riskId === "UNKNOWN") {
        const shortKey = riskName.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
        for (const [key, id] of riskStatementToId) {
          if (key.includes(shortKey) || shortKey.includes(key.split(" ").slice(0, 4).join(" "))) {
            riskId = id;
            break;
          }
        }
      }
    }

    // Extract Jira key from evidence ID
    const jiraMatch = evidenceId.match(/EW[-–]?\s*(\d+)/);
    const jiraKey = jiraMatch ? `EW-${jiraMatch[1]}` : "";

    // Create the evidence entry (the signal/finding)
    if (signal) {
      const evidenceEntry = await store.addEvidence({
        type: "signal",
        source: `Evidence work ${jiraKey || "unknown"}: ${testScope.slice(0, 60)}`,
        domain: capName ? inferDomain(capName, riskName) : "feasibility",
        content: `${signal}${limitations ? `\n\nLimitations: ${limitations}` : ""}${nextStep ? `\n\nNext step: ${nextStep}` : ""}`,
        date: today(),
        assumptions: [],
        confidence_impact: status?.toLowerCase().includes("validated") ? "increases" : status?.toLowerCase().includes("not") ? "decreases" : "neutral",
        capability_id: capId,
        tags: jiraKey ? [jiraKey] : [],
      });
      console.log(`  ${chalk.green(evidenceEntry.id)}: [signal] ${signal.slice(0, 65)}...`);

      // Create the assumption
      if (assumptionText) {
        const assumption = await store.addAssumption({
          risk_id: riskId,
          capability_id: capId,
          statement: assumptionText,
          domain: inferDomain(capName, riskName),
          status: mapEvidenceStatus(status),
          confidence: mapConfidence(currentConf),
          success_criteria: `Signal threshold met per test scope: ${testScope.slice(0, 100)}`,
          failure_criteria: `Signal threshold not met or limitations invalidate finding`,
          decision_consequence: nextStep
            ? `Next: ${nextStep.slice(0, 150)}`
            : `Evidence ${status?.toLowerCase().includes("validated") ? "supports" : "does not yet support"} confidence increase`,
          linked_evidence: [evidenceEntry.id],
          linked_slices: [],
        });
        console.log(`  ${chalk.green(assumption.id)}: [${assumption.status}] ${assumptionText.slice(0, 60)}...`);
      }
    }
  }
  console.log();

  // ─── Step 4: Import Slices from Jira ──────────────────────────────

  console.log(chalk.white.bold("Step 4: Slices from Jira"));

  let sliceCount = 0;
  for (const row of jiraRows) {
    const issueType = get(row, "IssueType", "Issue Type");
    if (issueType !== "Slice [subtask]") continue;

    const summary = get(row, "Summary");
    const status = get(row, "Status");
    const key = get(row, "Key");

    if (!summary) continue;

    // Map Jira status to slice status
    let sliceStatus: "planned" | "in_progress" | "complete" | "abandoned" = "planned";
    const s = status.toLowerCase();
    if (s === "done") sliceStatus = "complete";
    else if (s === "in progress") sliceStatus = "in_progress";
    else if (s === "to do") sliceStatus = "planned";

    const slice = await store.addSlice({
      assumption_id: "UNKNOWN",
      type: "feasibility",
      description: `${key}: ${summary}`,
      time_box: "1 week",
      instrumentation: "Manual verification and measurement",
      signal_definition: {
        success: "Test passes defined thresholds",
        failure: "Test fails or thresholds not met",
        promotion_trigger: "Signal validated within tolerance",
      },
      status: sliceStatus,
      signal_captured: sliceStatus === "complete" ? "Completed per evidence work" : undefined,
    });
    console.log(`  ${chalk.green(slice.id)}: [${sliceStatus}] ${summary.slice(0, 60)}`);
    sliceCount++;
  }
  console.log();

  // ─── Summary ──────────────────────────────────────────────────────

  const capabilities = await store.listCapabilities();
  const risks = await store.listRisks();
  const evidence = await store.listEvidence();
  const assumptions = await store.listAssumptions();
  const slices = await store.listSlices();

  console.log(chalk.white.bold("─── Seed Complete ───"));
  console.log();
  console.log(`  Capabilities:  ${chalk.green.bold(String(capabilities.length))}`);
  console.log(`  Risks:         ${chalk.green.bold(String(risks.length))}`);
  console.log(`  Evidence:      ${chalk.green.bold(String(evidence.length))}`);
  console.log(`  Assumptions:   ${chalk.green.bold(String(assumptions.length))}`);
  console.log(`  Slices:        ${chalk.green.bold(String(slices.length))}`);
  console.log();
  console.log(chalk.dim("Run: bun run vera -- status"));
  console.log(chalk.dim("Run: bun run vera -- monitor"));
  console.log(chalk.dim("Run: bun run vera -- generate artifacts"));
  console.log();
}

function inferDomain(capName: string, riskName: string): "value" | "usability" | "feasibility" | "viability" | "operational" {
  const combined = `${capName} ${riskName}`.toLowerCase();
  if (combined.includes("cost") || combined.includes("pricing") || combined.includes("licens") || combined.includes("liab")) return "viability";
  if (combined.includes("usab") || combined.includes("proficiency") || combined.includes("ux")) return "usability";
  if (combined.includes("sales") || combined.includes("adoption") || combined.includes("value") || combined.includes("trust")) return "value";
  if (combined.includes("operati") || combined.includes("battery") || combined.includes("cdn") || combined.includes("overheat")) return "operational";
  return "feasibility";
}

main().catch(console.error);
