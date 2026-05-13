import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../config.ts";
import { today } from "../utils.ts";
import type { EvidenceStore } from "../store/types.ts";
import {
  EvidenceTypeSchema,
  RiskDomainSchema,
  ImpactLevelSchema,
  UncertaintyLevelSchema,
  AssumptionStatusSchema,
  CommitmentStateSchema,
  ConfidenceLevelSchema,
  SliceTypeSchema,
  SliceStatusSchema,
  DecisionTypeSchema,
} from "../schema/index.ts";

async function ensureInit(store: EvidenceStore): Promise<boolean> {
  if (!(await store.isInitialized())) {
    console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
    return false;
  }
  return true;
}

export function registerAddCommand(program: Command): void {
  const add = program
    .command("add")
    .description("Add entities to the evidence store");

  // ─── vera add evidence ─────────────────────────────────────────────

  add
    .command("evidence")
    .description("Add an evidence entry")
    .requiredOption("--type <type>", `Evidence type (${EvidenceTypeSchema.options.join(", ")})`)
    .requiredOption("--source <source>", "Evidence source (e.g. 'CTO interview')")
    .requiredOption("--domain <domain>", `Risk domain (${RiskDomainSchema.options.join(", ")})`)
    .requiredOption("--content <content>", "The finding, constraint, or insight")
    .option("--capability <id>", "Linked capability ID")
    .option("--tags <tags>", "Comma-separated tags", "")
    .option("--date <date>", "Date captured (YYYY-MM-DD)")
    .option("--impact <impact>", "Confidence impact", "neutral")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const entry = await store.addEvidence({
        type: opts.type,
        source: opts.source,
        domain: opts.domain,
        content: opts.content,
        date: opts.date ?? today(),
        assumptions: [],
        confidence_impact: opts.impact,
        capability_id: opts.capability,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
      });

      console.log(chalk.green(`Added evidence ${chalk.bold(entry.id)}`));
      console.log(`  Type:    ${entry.type}`);
      console.log(`  Domain:  ${entry.domain}`);
      console.log(`  Source:  ${entry.source}`);
      console.log(`  Content: ${chalk.dim(entry.content.slice(0, 80))}${entry.content.length > 80 ? "..." : ""}`);
    });

  // ─── vera add risk ─────────────────────────────────────────────────

  add
    .command("risk")
    .description("Add a risk")
    .requiredOption("--capability <id>", "Linked capability ID")
    .requiredOption("--statement <statement>", "Risk statement: If [uncertainty], then [capability] may fail because [impact]")
    .requiredOption("--domain <domain>", `Risk domain (${RiskDomainSchema.options.join(", ")})`)
    .requiredOption("--impact <level>", `Impact level (${ImpactLevelSchema.options.join(", ")})`)
    .requiredOption("--uncertainty <level>", `Uncertainty level (${UncertaintyLevelSchema.options.join(", ")})`)
    .option("--test-cost <level>", "Test cost", "medium")
    .option("--status <status>", "Risk status", "open")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const risk = await store.addRisk({
        statement: opts.statement,
        domain: opts.domain,
        capability_id: opts.capability,
        impact: opts.impact,
        uncertainty: opts.uncertainty,
        test_cost: opts.testCost,
        status: opts.status,
        assumptions: [],
      });

      console.log(chalk.green(`Added risk ${chalk.bold(risk.id)} (priority: ${risk.priority_score?.toFixed(1)})`));
      console.log(`  Domain:      ${risk.domain}`);
      console.log(`  Impact:      ${risk.impact}`);
      console.log(`  Uncertainty: ${risk.uncertainty}`);
      console.log(`  Statement:   ${chalk.dim(risk.statement.slice(0, 80))}${risk.statement.length > 80 ? "..." : ""}`);
    });

  // ─── vera add assumption ───────────────────────────────────────────

  add
    .command("assumption")
    .description("Add an assumption")
    .requiredOption("--risk <id>", "Parent risk ID")
    .requiredOption("--capability <id>", "Linked capability ID")
    .requiredOption("--statement <statement>", "Testable assumption statement")
    .requiredOption("--domain <domain>", `Risk domain (${RiskDomainSchema.options.join(", ")})`)
    .requiredOption("--success <criteria>", "Success criteria")
    .requiredOption("--failure <criteria>", "Failure criteria")
    .requiredOption("--consequence <text>", "Decision consequence if validated/invalidated")
    .option("--status <status>", "Assumption status", "untested")
    .option("--confidence <level>", "Confidence level", "low")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const assumption = await store.addAssumption({
        risk_id: opts.risk,
        capability_id: opts.capability,
        statement: opts.statement,
        domain: opts.domain,
        status: opts.status,
        confidence: opts.confidence,
        success_criteria: opts.success,
        failure_criteria: opts.failure,
        decision_consequence: opts.consequence,
        linked_evidence: [],
        linked_slices: [],
      });

      console.log(chalk.green(`Added assumption ${chalk.bold(assumption.id)}`));
      console.log(`  Risk:       ${assumption.risk_id}`);
      console.log(`  Status:     ${assumption.status}`);
      console.log(`  Confidence: ${assumption.confidence}`);
      console.log(`  Statement:  ${chalk.dim(assumption.statement.slice(0, 80))}${assumption.statement.length > 80 ? "..." : ""}`);
    });

  // ─── vera add capability ──────────────────────────────────────────

  add
    .command("capability")
    .description("Add a capability")
    .requiredOption("--name <name>", "Capability name")
    .requiredOption("--description <description>", "What this capability does")
    .option("--state <state>", "Commitment state", "concept")
    .option("--confidence <level>", "Confidence level", "low")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const capability = await store.addCapability({
        name: opts.name,
        description: opts.description,
        commitment_state: opts.state,
        confidence: opts.confidence,
        assumptions: [],
        risks: [],
        promotion_history: [],
      });

      console.log(chalk.green(`Added capability ${chalk.bold(capability.id)}`));
      console.log(`  Name:       ${capability.name}`);
      console.log(`  State:      ${capability.commitment_state}`);
      console.log(`  Confidence: ${capability.confidence}`);
    });

  // ─── vera add slice ────────────────────────────────────────────────

  add
    .command("slice")
    .description("Add a test slice")
    .requiredOption("--assumption <id>", "Parent assumption ID")
    .requiredOption("--type <type>", `Slice type (${SliceTypeSchema.options.join(", ")})`)
    .requiredOption("--description <description>", "What is being tested")
    .requiredOption("--timebox <duration>", "Time box (e.g. '3 days', '1 week')")
    .requiredOption("--instrumentation <how>", "How signal will be captured")
    .requiredOption("--success-signal <threshold>", "Success threshold")
    .requiredOption("--failure-signal <threshold>", "Failure threshold")
    .requiredOption("--promotion-trigger <trigger>", "What triggers promotion")
    .option("--status <status>", "Slice status", "planned")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const slice = await store.addSlice({
        assumption_id: opts.assumption,
        type: opts.type,
        description: opts.description,
        time_box: opts.timebox,
        instrumentation: opts.instrumentation,
        signal_definition: {
          success: opts.successSignal,
          failure: opts.failureSignal,
          promotion_trigger: opts.promotionTrigger,
        },
        status: opts.status,
      });

      console.log(chalk.green(`Added slice ${chalk.bold(slice.id)}`));
      console.log(`  Assumption: ${slice.assumption_id}`);
      console.log(`  Timebox:    ${slice.time_box}`);
      console.log(`  Status:     ${slice.status}`);
    });

  // ─── vera add decision ─────────────────────────────────────────────

  add
    .command("decision")
    .description("Record a decision")
    .requiredOption("--type <type>", `Decision type (${DecisionTypeSchema.options.join(", ")})`)
    .requiredOption("--rationale <rationale>", "Decision rationale")
    .requiredOption("--by <name>", "Who made the decision")
    .option("--assumption <id>", "Related assumption ID")
    .option("--capability <id>", "Related capability ID")
    .option("--evidence <ids>", "Comma-separated evidence IDs", "")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await ensureInit(store))) return;

      const decision = await store.addDecision({
        type: opts.type,
        rationale: opts.rationale,
        made_by: opts.by,
        assumption_id: opts.assumption,
        capability_id: opts.capability,
        evidence_ids: opts.evidence ? opts.evidence.split(",").map((s: string) => s.trim()) : [],
        date: today(),
      });

      console.log(chalk.green(`Recorded decision ${chalk.bold(decision.id)}`));
      console.log(`  Type:      ${decision.type}`);
      console.log(`  Rationale: ${chalk.dim(decision.rationale.slice(0, 80))}`);
    });
}
