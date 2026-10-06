import type { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { formatIssues, parseEvidenceLog, profileEvidence } from "../evidence/validate.ts";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate an evidence log file and show what it can support")
    .argument("<file>", "Evidence log JSON")
    .action(async (file: string) => {
      const result = parseEvidenceLog(await readFile(file, "utf-8"));
      if (!result.ok) {
        console.log(chalk.red(`✗ ${file} is not a valid evidence log:`));
        console.log(formatIssues(result.issues));
        process.exitCode = 1;
        return;
      }
      const p = profileEvidence(result.log);
      console.log(chalk.green(`✓ ${file}: ${p.total} items (high ${p.byConfidence.high}, medium ${p.byConfidence.medium}, low ${p.byConfidence.low})`));
      console.log(`  readiness: ${p.readiness}${p.reasons.length ? chalk.dim(` — ${p.reasons.join("; ")}`) : ""}`);
      if (p.conflictPairs.length) console.log(`  conflicts: ${p.conflictPairs.map(([a, b]) => `${a} ↔ ${b}`).join(", ")}`);
    });
}
