import type { Command } from "commander";
import chalk from "chalk";
import { getStore, resolveStorePath, resolveArtifactsPath, loadConfig } from "../config.ts";
import { generateAllArtifacts, generateArtifact } from "../generator/artifacts/index.ts";
import { generateCandidateAssumptions } from "../generator/assumptions.ts";
import type { ArtifactType } from "../schema/index.ts";
import { sendSlackMessage, formatRegenerationSlackMessage } from "../communication/slack.ts";
import { StacksClient, IdMap, mapGeneratedArtifact } from "../stacks/index.ts";

async function pushArtifactToStacks(
  config: Awaited<ReturnType<typeof loadConfig>>,
  veraType: string,
  content: string,
): Promise<void> {
  if (!config.stacks?.sync_enabled) return;

  try {
    const client = new StacksClient(config.stacks.url);
    const idMap = new IdMap(resolveStorePath());
    const allStacksIds = await idMap.allValues();
    const payload = mapGeneratedArtifact(veraType, content, allStacksIds);
    const stacksId = await client.createArtifact(config.stacks.fieldbook_id, payload);
    console.log(chalk.dim(`  [stacks] synced artifact → ${stacksId}`));
  } catch (e) {
    console.error(chalk.yellow(`  [stacks] failed to sync artifact:`), e instanceof Error ? e.message : e);
  }
}

export function registerGenerateCommand(program: Command): void {
  const gen = program
    .command("generate")
    .description("Generate artifacts or assumptions from the evidence store");

  gen
    .command("artifacts")
    .description("Generate all enabled artifacts")
    .action(async () => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const config = await loadConfig();
      const artifactsDir = resolveArtifactsPath();
      const enabledWithGenerators = config.artifacts_enabled.filter(
        (t) => ["strategy", "roadmap", "scope_check"].includes(t),
      );

      console.log();
      console.log(
        chalk.white.bold(`Generating artifacts`) +
        chalk.dim(` (${enabledWithGenerators.length} enabled: ${enabledWithGenerators.join(", ")})`),
      );
      console.log();

      const results = await generateAllArtifacts(
        store,
        { ...config, artifacts_enabled: enabledWithGenerators },
        artifactsDir,
        (type, status, elapsed) => {
          const label = type.replace(/_/g, " ").padEnd(18);
          if (status === "start") {
            process.stdout.write(`  ${label} ${"·".repeat(10)} `);
          } else if (status === "done") {
            console.log(chalk.green(`done`) + chalk.dim(` (${elapsed?.toFixed(1)}s)`));
          } else {
            console.log(chalk.red("failed"));
          }
        },
      );

      console.log();
      console.log(chalk.green.bold(`${results.length} artifact(s) written to ${artifactsDir}/current/`));
      for (const r of results) {
        console.log(`  ${chalk.dim(r.filePath)}`);
      }

      // Push generated artifacts to Stacks
      for (const r of results) {
        await pushArtifactToStacks(config, r.type, r.content);
      }

      // Slack notification
      if (config.slack_webhook) {
        const msg = formatRegenerationSlackMessage(
          results.map((r) => r.type),
          [],
        );
        await sendSlackMessage(config.slack_webhook, msg);
        console.log(chalk.dim("\n  Slack notified."));
      }

      console.log();
    });

  gen
    .command("artifact")
    .description("Generate a specific artifact")
    .requiredOption("--type <type>", "Artifact type (strategy, roadmap, scope_check)")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const config = await loadConfig();
      const artifactsDir = resolveArtifactsPath();
      const type = opts.type as ArtifactType;

      console.log();
      console.log(chalk.white.bold(`Generating ${type}...`));

      const startTime = Date.now();
      try {
        const result = await generateArtifact(store, type, config, artifactsDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(chalk.green(`\n  Done in ${elapsed}s → ${result.filePath}`));
        await pushArtifactToStacks(config, result.type, result.content);
      } catch (err) {
        console.log(chalk.red(`\n  Failed: ${err}`));
      }
      console.log();
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

