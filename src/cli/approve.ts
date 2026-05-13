import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../config.ts";

export function registerApproveCommand(program: Command): void {
  const approve = program
    .command("approve")
    .description("Approve candidate items");

  approve
    .command("assumption")
    .description("Approve a candidate assumption (moves it to the evidence store)")
    .requiredOption("--id <id>", "Candidate assumption ID (e.g. CAND-001)")
    .action(async (opts) => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      try {
        const assumption = await store.approveCandidate(opts.id);
        console.log();
        console.log(chalk.green.bold(`Approved candidate ${opts.id} → ${assumption.id}`));
        console.log();
        console.log(`  Statement:  ${assumption.statement}`);
        console.log(`  Risk:       ${assumption.risk_id}`);
        console.log(`  Capability: ${assumption.capability_id}`);
        console.log(`  Status:     ${assumption.status}`);
        console.log(`  Domain:     ${assumption.domain}`);
        console.log();
      } catch (err) {
        console.log(chalk.red(`\n  Failed: ${err}\n`));
      }
    });

  // List pending candidates
  approve
    .command("list")
    .description("List all pending candidate assumptions")
    .action(async () => {
      const store = await getStore();
      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const candidates = await store.listCandidates();

      if (candidates.length === 0) {
        console.log(chalk.dim("\nNo pending candidates.\n"));
        return;
      }

      console.log();
      console.log(chalk.white.bold(`${candidates.length} pending candidate(s):`));
      console.log();
      for (const c of candidates) {
        console.log(`  ${chalk.bold(c.id)} (${c.risk_id} → ${c.capability_id})`);
        console.log(`    ${c.statement}`);
        console.log(chalk.dim(`    Success: ${c.success_criteria}`));
        console.log(chalk.dim(`    Failure: ${c.failure_criteria}`));
        console.log();
      }
      console.log(chalk.dim(`Approve with: vera approve assumption --id <CAND-xxx>`));
      console.log();
    });
}
