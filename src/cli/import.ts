import type { Command } from "commander";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { parse } from "csv-parse/sync";
import { getStore } from "../config.ts";
import { today } from "../utils.ts";

interface CsvRow {
  [key: string]: string;
}

function normalize(key: string): string {
  return key.toLowerCase().trim().replace(/[\s_-]+/g, "_");
}

function get(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) {
    const normalized = normalize(key);
    for (const [k, v] of Object.entries(row)) {
      if (normalize(k) === normalized && v?.trim()) {
        return v.trim();
      }
    }
  }
  return "";
}

function parseCsv(content: string): CsvRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as CsvRow[];
}

export function registerImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import data from CSV files into the evidence store")
    .requiredOption("--file <path>", "Path to CSV file")
    .requiredOption(
      "--type <type>",
      "Entity type: evidence, risks, assumptions, capabilities, slices, decisions",
    )
    .action(async (opts) => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const content = await readFile(opts.file, "utf-8");
      const rows = parseCsv(content);

      if (rows.length === 0) {
        console.log(chalk.yellow("No rows found in CSV file."));
        return;
      }

      console.log(chalk.dim(`Found ${rows.length} rows in ${opts.file}`));
      console.log();

      // Load existing capabilities for name→ID resolution
      const existingCaps = await store.listCapabilities();
      const capNameToId = new Map<string, string>();
      for (const cap of existingCaps) {
        capNameToId.set(cap.name.toLowerCase(), cap.id);
      }

      // Load existing risks for statement→ID resolution
      const existingRisks = await store.listRisks();
      const riskStatementToId = new Map<string, string>();
      for (const risk of existingRisks) {
        riskStatementToId.set(risk.statement.toLowerCase().slice(0, 50), risk.id);
        riskStatementToId.set(risk.id.toLowerCase(), risk.id);
      }

      function resolveCapability(row: CsvRow): string {
        const capRef = get(row, "capability", "capability_id", "cap", "capability_name");
        if (capRef.startsWith("CAP-")) return capRef;
        const found = capNameToId.get(capRef.toLowerCase());
        return found || capRef || "UNKNOWN";
      }

      function resolveRisk(row: CsvRow): string {
        const riskRef = get(row, "risk", "risk_id", "parent_risk");
        if (riskRef.startsWith("RISK-")) return riskRef;
        const found = riskStatementToId.get(riskRef.toLowerCase().slice(0, 50));
        return found || riskRef || "UNKNOWN";
      }

      let imported = 0;
      let skipped = 0;

      switch (opts.type) {
        case "capabilities": {
          for (const row of rows) {
            const name = get(row, "name", "capability", "capability_name");
            if (!name) { skipped++; continue; }
            const cap = await store.addCapability({
              name,
              description: get(row, "description", "desc") || name,
              commitment_state: (get(row, "state", "commitment_state", "status") || "concept") as any,
              confidence: (get(row, "confidence", "confidence_level") || "low") as any,
              assumptions: [],
              risks: [],
              promotion_history: [],
            });
            capNameToId.set(name.toLowerCase(), cap.id);
            console.log(chalk.green(`  ${cap.id}: ${name}`));
            imported++;
          }
          break;
        }

        case "evidence": {
          for (const row of rows) {
            const contentVal = get(row, "content", "finding", "insight", "description", "note");
            if (!contentVal) { skipped++; continue; }
            const entry = await store.addEvidence({
              type: (get(row, "type", "evidence_type") || "stakeholder_insight") as any,
              source: get(row, "source", "origin") || "imported",
              domain: (get(row, "domain", "risk_domain") || "value") as any,
              content: contentVal,
              date: get(row, "date", "captured_date") || today(),
              assumptions: [],
              confidence_impact: (get(row, "impact", "confidence_impact") || "neutral") as any,
              capability_id: resolveCapability(row) || undefined,
              tags: get(row, "tags") ? get(row, "tags").split(",").map((t) => t.trim()) : [],
            });
            console.log(chalk.green(`  ${entry.id}: ${contentVal.slice(0, 60)}...`));
            imported++;
          }
          break;
        }

        case "risks": {
          for (const row of rows) {
            const statement = get(row, "statement", "risk", "risk_statement", "description");
            if (!statement) { skipped++; continue; }
            const risk = await store.addRisk({
              statement,
              domain: (get(row, "domain", "risk_domain") || "value") as any,
              capability_id: resolveCapability(row),
              impact: (get(row, "impact", "impact_level") || "medium") as any,
              uncertainty: (get(row, "uncertainty", "uncertainty_level") || "medium") as any,
              test_cost: (get(row, "test_cost", "cost") || "medium") as any,
              status: (get(row, "status") || "open") as any,
              assumptions: [],
            });
            riskStatementToId.set(statement.toLowerCase().slice(0, 50), risk.id);
            console.log(chalk.green(`  ${risk.id}: ${statement.slice(0, 60)}...`));
            imported++;
          }
          break;
        }

        case "assumptions": {
          for (const row of rows) {
            const statement = get(row, "statement", "assumption", "hypothesis");
            if (!statement) { skipped++; continue; }
            const assumption = await store.addAssumption({
              risk_id: resolveRisk(row),
              capability_id: resolveCapability(row),
              statement,
              domain: (get(row, "domain", "risk_domain") || "value") as any,
              status: (get(row, "status", "assumption_status") || "untested") as any,
              confidence: (get(row, "confidence", "confidence_level") || "low") as any,
              success_criteria: get(row, "success", "success_criteria", "success_metric") || "To be defined",
              failure_criteria: get(row, "failure", "failure_criteria", "failure_metric") || "To be defined",
              decision_consequence: get(row, "consequence", "decision_consequence", "decision") || "To be defined",
              linked_evidence: [],
              linked_slices: [],
            });
            console.log(chalk.green(`  ${assumption.id}: ${statement.slice(0, 60)}...`));
            imported++;
          }
          break;
        }

        case "slices": {
          for (const row of rows) {
            const description = get(row, "description", "slice", "test");
            if (!description) { skipped++; continue; }

            // Resolve assumption
            const asmRef = get(row, "assumption", "assumption_id", "parent_assumption");
            const existingAsms = await store.listAssumptions();
            let asmId = asmRef;
            if (!asmRef.startsWith("ASM-")) {
              const found = existingAsms.find(
                (a) => a.statement.toLowerCase().includes(asmRef.toLowerCase().slice(0, 30)),
              );
              asmId = found?.id || asmRef;
            }

            const slice = await store.addSlice({
              assumption_id: asmId,
              type: (get(row, "type", "slice_type") || "user_signal") as any,
              description,
              time_box: get(row, "timebox", "time_box", "duration") || "1 week",
              instrumentation: get(row, "instrumentation", "how") || "Manual observation",
              signal_definition: {
                success: get(row, "success_signal", "success") || "To be defined",
                failure: get(row, "failure_signal", "failure") || "To be defined",
                promotion_trigger: get(row, "promotion_trigger", "trigger") || "To be defined",
              },
              status: (get(row, "status") || "planned") as any,
              signal_captured: get(row, "signal_captured", "result") || undefined,
            });
            console.log(chalk.green(`  ${slice.id}: ${description.slice(0, 60)}...`));
            imported++;
          }
          break;
        }

        case "decisions": {
          for (const row of rows) {
            const rationale = get(row, "rationale", "reason", "description");
            if (!rationale) { skipped++; continue; }
            const decision = await store.addDecision({
              type: (get(row, "type", "decision_type") || "iterate") as any,
              rationale,
              made_by: get(row, "by", "made_by", "author", "who") || "imported",
              assumption_id: get(row, "assumption", "assumption_id") || undefined,
              capability_id: resolveCapability(row) || undefined,
              evidence_ids: get(row, "evidence", "evidence_ids")
                ? get(row, "evidence", "evidence_ids").split(",").map((s) => s.trim())
                : [],
              date: get(row, "date") || today(),
            });
            console.log(chalk.green(`  ${decision.id}: ${rationale.slice(0, 60)}...`));
            imported++;
          }
          break;
        }

        default:
          console.log(chalk.red(`Unknown type: ${opts.type}. Use: evidence, risks, assumptions, capabilities, slices, decisions`));
          return;
      }

      console.log();
      console.log(chalk.green.bold(`Imported ${imported} ${opts.type}`) + (skipped > 0 ? chalk.yellow(` (${skipped} skipped)`) : ""));
      console.log();
    });
}
