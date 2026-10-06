import type { Command } from "commander";
import chalk from "chalk";
import { readFile, writeFile } from "node:fs/promises";
import { getStore, loadConfig } from "../config.ts";
import { generateCandidateAssumptions } from "../generator/assumptions.ts";
import { formatCheckIssues } from "../deliverables/check.ts";
import { DELIVERABLES, isDeliverableId } from "../deliverables/specs.ts";
import { formatIssues, parseEvidenceLog } from "../evidence/validate.ts";
import { createProvider, createTraceSink, loadLlmConfig } from "../llm/index.ts";
import { generateDeliverable } from "../pipeline/generate.ts";

export function registerGenerateCommand(program: Command): void {
  const gen = program
    .command("generate")
    .description("Generate deliverables from an evidence log, or assumptions from the evidence store");

  gen
    .command("deliverable")
    .description("Generate a checked deliverable from an evidence log file")
    .requiredOption("--log <file>", "Evidence log JSON (see examples/logs/)")
    .requiredOption("--type <type>", `Deliverable: ${Object.keys(DELIVERABLES).join(", ")}`)
    .option("--out <file>", "Write the checked deliverable JSON here")
    .action(async (opts) => {
      if (!isDeliverableId(opts.type)) {
        console.log(chalk.red(`Unknown deliverable "${opts.type}". Choose: ${Object.keys(DELIVERABLES).join(", ")}`));
        process.exitCode = 1;
        return;
      }
      const parsed = parseEvidenceLog(await readFile(opts.log, "utf-8"));
      if (!parsed.ok) {
        console.log(chalk.red(`Invalid evidence log ${opts.log}:`));
        console.log(formatIssues(parsed.issues));
        process.exitCode = 1;
        return;
      }

      const config = loadLlmConfig();
      const spec = DELIVERABLES[opts.type as keyof typeof DELIVERABLES];
      console.log();
      console.log(chalk.white.bold(`Generating ${spec.title.toLowerCase()}`) + chalk.dim(` (${config.provider}/${config.model})`));

      let provider;
      try {
        provider = createProvider(config);
      } catch (err) {
        console.log(chalk.red(`  ${(err as Error).message}`));
        process.exitCode = 1;
        return;
      }
      const result = await generateDeliverable({
        log: parsed.log,
        spec,
        provider,
        config,
        trace: createTraceSink(config),
        onEvent: (e) => {
          if (e.type === "start") console.log(chalk.dim(`  evidence readiness: ${e.profile.readiness}`));
          if (e.type === "attempt") process.stdout.write(chalk.dim(`  attempt ${e.attempt}/${e.max_attempts} `));
          if (e.type === "draft_section") process.stdout.write(chalk.dim("·"));
          if (e.type === "retry") console.log(chalk.yellow(` ${e.issues.length} issue(s), retrying`));
          if (e.type === "done") console.log(chalk.green(" passed checks"));
          if (e.type === "failed") console.log(chalk.red(" failed checks"));
        },
      });

      if (!result.ok) {
        console.log(chalk.red(`\n  ${result.message}:`));
        console.log(formatCheckIssues(result.issues));
        process.exitCode = 1;
        return;
      }
      const json = JSON.stringify(result.deliverable, null, 2);
      if (opts.out) {
        await writeFile(opts.out, json);
        console.log(chalk.dim(`  written to ${opts.out}`));
      } else {
        console.log(json);
      }
      console.log(chalk.dim(`  ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens, ${(result.usage.latency_ms / 1000).toFixed(1)}s`));
    });

  // ─── vera generate assumptions ───────────────────────────────────

  gen
    .command("assumptions")
    .description("Generate candidate assumptions for a risk")
    .requiredOption("--risk <id>", "Risk ID to generate assumptions for")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const config = await loadConfig();
      const riskId = opts.risk;

      console.log();
      console.log(chalk.white.bold(`Generating candidate assumptions for ${riskId}...`));

      try {
        const candidates = await generateCandidateAssumptions(
          store,
          riskId,
          config.llm.generation_model,
        );

        console.log(chalk.green(`\n  Generated ${candidates.length} candidate(s):\n`));
        for (const c of candidates) {
          console.log(`  ${chalk.bold(c.id)}: ${c.statement}`);
          console.log(chalk.dim(`    Success: ${c.success_criteria}`));
          console.log(chalk.dim(`    Failure: ${c.failure_criteria}`));
          console.log(chalk.dim(`    Consequence: ${c.decision_consequence}`));
          console.log();
        }

        console.log(chalk.dim(`Candidates saved to evidence-store/candidates/`));
        console.log(chalk.dim(`Approve with: vera approve assumption --id <CAND-xxx>`));
      } catch (err) {
        console.log(chalk.red(`\n  Failed: ${err}`));
      }
      console.log();
    });
}

