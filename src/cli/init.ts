import type { Command } from "commander";
import chalk from "chalk";
import { mkdir } from "fs/promises";
import { JsonEvidenceStore } from "../store/index.ts";
import { resolveStorePath, resolveArtifactsPath, saveConfig, defaultConfig } from "../config.ts";
import { now } from "../utils.ts";
import type { EngagementContext } from "../schema/index.ts";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new VERA evidence store for an engagement")
    .requiredOption("--engagement <name>", "Client or engagement name")
    .option("--weeks <number>", "Duration in weeks", "8")
    .option("--team <number>", "Team size", "3")
    .option("--cadence <cadence>", "Delivery cadence", "weekly sprint")
    .option("--commercial <structure>", "Commercial structure", "T&M")
    .action(async (opts) => {
      const storePath = resolveStorePath();
      const artifactsPath = resolveArtifactsPath();

      const store = new JsonEvidenceStore(storePath);

      if (await store.isInitialized()) {
        console.log(chalk.yellow("Evidence store already initialized at:"), storePath);
        return;
      }

      const context: EngagementContext = {
        engagement_id: opts.engagement.toLowerCase().replace(/\s+/g, "-"),
        client_name: opts.engagement,
        duration_weeks: parseInt(opts.weeks, 10),
        team: [],
        delivery_cadence: opts.cadence,
        commercial_structure: opts.commercial,
        client_constraints: [],
        deliverables_required: [],
        start_date: now().split("T")[0]!,
        current_week: 1,
      };

      await store.initialize(context);

      await mkdir(`${artifactsPath}/current`, { recursive: true });
      await mkdir(`${artifactsPath}/history`, { recursive: true });

      const config = defaultConfig();
      await saveConfig(config);

      console.log();
      console.log(chalk.green.bold("VERA initialized"));
      console.log();
      console.log(`  Engagement:  ${chalk.white.bold(opts.engagement)}`);
      console.log(`  Duration:    ${opts.weeks} weeks`);
      console.log(`  Team size:   ${opts.team}`);
      console.log(`  Cadence:     ${opts.cadence}`);
      console.log(`  Commercial:  ${opts.commercial}`);
      console.log();
      console.log(`  Evidence store:  ${chalk.dim(storePath)}`);
      console.log(`  Artifacts:       ${chalk.dim(artifactsPath)}`);
      console.log(`  Config:          ${chalk.dim("vera.config.json")}`);
      console.log();
      console.log(chalk.dim("Next: vera add evidence | vera add risk | vera add capability"));
    });
}
