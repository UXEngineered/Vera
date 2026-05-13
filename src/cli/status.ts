import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../config.ts";
import type { RiskDomain } from "../schema/index.ts";

const ALL_DOMAINS: RiskDomain[] = ["value", "usability", "feasibility", "viability", "operational"];

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show evidence store health summary")
    .action(async () => {
      const store = await getStore();

      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const context = await store.getContext();
      const evidence = await store.listEvidence();
      const risks = await store.listRisks();
      const assumptions = await store.listAssumptions();
      const slices = await store.listSlices();
      const capabilities = await store.listCapabilities();
      const candidates = await store.listCandidates();

      // Compute domain coverage
      const domainsCovered = new Set(evidence.map((e) => e.domain));
      const domainsWithout = ALL_DOMAINS.filter((d) => !domainsCovered.has(d));

      // Count assumption statuses
      const asmByStatus = {
        untested: assumptions.filter((a) => a.status === "untested").length,
        testing: assumptions.filter((a) => a.status === "testing").length,
        validated: assumptions.filter((a) => a.status === "validated").length,
        invalidated: assumptions.filter((a) => a.status === "invalidated").length,
        conditional: assumptions.filter((a) => a.status === "conditional").length,
      };

      // Count capability states
      const capByState = {
        concept: capabilities.filter((c) => c.commitment_state === "concept").length,
        validation: capabilities.filter((c) => c.commitment_state === "validation").length,
        commitment: capabilities.filter((c) => c.commitment_state === "commitment").length,
      };

      // Count risk severities
      const openRisks = risks.filter((r) => r.status === "open");
      const riskBySeverity = {
        critical: openRisks.filter((r) => r.impact === "critical").length,
        high: openRisks.filter((r) => r.impact === "high").length,
        medium: openRisks.filter((r) => r.impact === "medium").length,
        low: openRisks.filter((r) => r.impact === "low").length,
      };

      // Count slice statuses
      const sliceByStatus = {
        planned: slices.filter((s) => s.status === "planned").length,
        in_progress: slices.filter((s) => s.status === "in_progress").length,
        complete: slices.filter((s) => s.status === "complete").length,
        abandoned: slices.filter((s) => s.status === "abandoned").length,
      };

      // Determine health
      const hasGaps = domainsWithout.length > 0 || openRisks.some((r) => {
        const riskAssumptions = assumptions.filter((a) => a.risk_id === r.id);
        return riskAssumptions.length === 0;
      });
      const hasCritical = capabilities.some((c) => {
        if (c.commitment_state !== "commitment") return false;
        const capAssumptions = assumptions.filter((a) => a.capability_id === c.id);
        return capAssumptions.some((a) => a.status === "untested");
      });

      const healthLabel = hasCritical
        ? chalk.red.bold("CRITICAL GAPS")
        : hasGaps
          ? chalk.yellow.bold("GAPS PRESENT")
          : chalk.green.bold("HEALTHY");

      // Print
      console.log();
      if (context) {
        console.log(
          chalk.white.bold(`VERA — ${context.client_name}`) +
          chalk.dim(` (Week ${context.current_week} of ${context.duration_weeks})`),
        );
        const teamSize = context.team.length || "not specified";
        console.log(
          chalk.dim(`Team: ${teamSize} | Cadence: ${context.delivery_cadence} | Commercial: ${context.commercial_structure}`),
        );
      } else {
        console.log(chalk.white.bold("VERA — Evidence Store Status"));
      }

      console.log();
      console.log(`Evidence Health: ${healthLabel}`);
      console.log();

      // Capabilities
      const capParts = [];
      if (capByState.concept > 0) capParts.push(`${capByState.concept} concept`);
      if (capByState.validation > 0) capParts.push(`${capByState.validation} validation`);
      if (capByState.commitment > 0) capParts.push(`${capByState.commitment} commitment`);
      console.log(`  Capabilities:  ${chalk.white.bold(String(capabilities.length))} ${capParts.length > 0 ? chalk.dim(`(${capParts.join(", ")})`) : ""}`);

      // Risks
      const riskParts = [];
      if (riskBySeverity.critical > 0) riskParts.push(chalk.red(`${riskBySeverity.critical} critical`));
      if (riskBySeverity.high > 0) riskParts.push(chalk.yellow(`${riskBySeverity.high} high`));
      if (riskBySeverity.medium > 0) riskParts.push(`${riskBySeverity.medium} medium`);
      if (riskBySeverity.low > 0) riskParts.push(`${riskBySeverity.low} low`);
      console.log(`  Risks:         ${chalk.white.bold(String(risks.length))} ${riskParts.length > 0 ? chalk.dim("(") + riskParts.join(chalk.dim(", ")) + chalk.dim(")") : ""} — ${openRisks.length} open`);

      // Assumptions
      const asmParts = [];
      if (asmByStatus.untested > 0) asmParts.push(`${asmByStatus.untested} untested`);
      if (asmByStatus.testing > 0) asmParts.push(`${asmByStatus.testing} testing`);
      if (asmByStatus.validated > 0) asmParts.push(chalk.green(`${asmByStatus.validated} validated`));
      if (asmByStatus.invalidated > 0) asmParts.push(chalk.red(`${asmByStatus.invalidated} invalidated`));
      if (asmByStatus.conditional > 0) asmParts.push(`${asmByStatus.conditional} conditional`);
      console.log(`  Assumptions:   ${chalk.white.bold(String(assumptions.length))} ${asmParts.length > 0 ? chalk.dim("(") + asmParts.join(chalk.dim(", ")) + chalk.dim(")") : ""}`);

      // Evidence
      console.log(`  Evidence:      ${chalk.white.bold(String(evidence.length))} entries across ${chalk.white.bold(String(domainsCovered.size))} of ${ALL_DOMAINS.length} risk domains`);

      // Slices
      const sliceParts = [];
      if (sliceByStatus.planned > 0) sliceParts.push(`${sliceByStatus.planned} planned`);
      if (sliceByStatus.in_progress > 0) sliceParts.push(`${sliceByStatus.in_progress} in-progress`);
      if (sliceByStatus.complete > 0) sliceParts.push(chalk.green(`${sliceByStatus.complete} complete`));
      if (sliceByStatus.abandoned > 0) sliceParts.push(chalk.dim(`${sliceByStatus.abandoned} abandoned`));
      console.log(`  Slices:        ${chalk.white.bold(String(slices.length))} ${sliceParts.length > 0 ? chalk.dim("(") + sliceParts.join(chalk.dim(", ")) + chalk.dim(")") : ""}`);

      // Candidates
      if (candidates.length > 0) {
        console.log(`  Candidates:    ${chalk.yellow.bold(String(candidates.length))} pending review`);
      }

      // Domain coverage
      console.log();
      if (domainsCovered.size > 0) {
        console.log(`  Domains with evidence:    ${chalk.green([...domainsCovered].join(", "))}`);
      }
      if (domainsWithout.length > 0) {
        console.log(`  Domains ${chalk.red("WITHOUT")} evidence: ${chalk.red(domainsWithout.join(", "))}`);
      }

      console.log();
    });
}
