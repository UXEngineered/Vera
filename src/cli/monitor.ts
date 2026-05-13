import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../config.ts";
import { runMonitor } from "../monitor/index.ts";
import type { Alert, MonitorReport } from "../schema/index.ts";

function severityIcon(severity: string): string {
  switch (severity) {
    case "critical": return chalk.red.bold("CRITICAL");
    case "warning": return chalk.yellow.bold("WARNING ");
    case "info": return chalk.blue("INFO    ");
    default: return severity;
  }
}

function printAlerts(alerts: Alert[], label: string): void {
  if (alerts.length === 0) return;
  console.log();
  console.log(chalk.white.bold.underline(label));
  console.log();
  for (const alert of alerts) {
    console.log(`  ${severityIcon(alert.severity)}  ${alert.message}`);
    if (alert.suggested_action) {
      console.log(`             ${chalk.dim("→ " + alert.suggested_action)}`);
    }
  }
}

export function printMonitorReport(report: MonitorReport): void {
  const totalAlerts =
    report.gaps.length +
    report.drift_warnings.length +
    report.staleness_warnings.length +
    report.state_inconsistencies.length;

  console.log();
  console.log(chalk.white.bold("VERA Monitor Report"));
  console.log(chalk.dim(`Generated: ${report.generated_at}`));
  console.log();

  const healthLabel =
    report.overall_evidence_health === "critical_gaps"
      ? chalk.red.bold("CRITICAL GAPS")
      : report.overall_evidence_health === "gaps_present"
        ? chalk.yellow.bold("GAPS PRESENT")
        : chalk.green.bold("HEALTHY");

  console.log(`  Evidence Health: ${healthLabel}`);
  console.log(`  Total Alerts:    ${totalAlerts === 0 ? chalk.green("0") : chalk.yellow.bold(String(totalAlerts))}`);

  // State inconsistencies first (most critical)
  printAlerts(report.state_inconsistencies, "State Inconsistencies");
  printAlerts(report.gaps, "Evidence Gaps");
  printAlerts(report.drift_warnings, "Drift Warnings");
  printAlerts(report.staleness_warnings, "Staleness Warnings");

  // Risk priority ranking
  if (report.risk_priority_ranking.length > 0) {
    console.log();
    console.log(chalk.white.bold.underline("Risk Priority Ranking"));
    console.log();
    for (let i = 0; i < report.risk_priority_ranking.length; i++) {
      const r = report.risk_priority_ranking[i]!;
      const rank = `#${i + 1}`;
      const impactColor =
        r.impact === "critical" ? chalk.red :
        r.impact === "high" ? chalk.yellow :
        chalk.white;
      const asmStatus = r.has_assumptions
        ? chalk.green("has assumptions")
        : chalk.red("NO assumptions");
      const sliceStatus = r.active_slices > 0
        ? chalk.green(`${r.active_slices} active slice(s)`)
        : chalk.dim("no active slices");

      console.log(
        `  ${chalk.bold(rank.padEnd(4))} ${impactColor(r.impact.padEnd(9))} ${r.uncertainty.padEnd(7)} uncertainty  ${r.risk_id}  ${asmStatus} | ${sliceStatus}`,
      );
      console.log(`        ${chalk.dim(r.statement.slice(0, 90))}${r.statement.length > 90 ? "..." : ""}`);
    }
  }

  if (totalAlerts === 0) {
    console.log();
    console.log(chalk.green("  ✓ No alerts. Evidence store is healthy."));
  }

  console.log();
}

export function registerMonitorCommand(program: Command): void {
  program
    .command("monitor")
    .description("Run evidence monitor — detect gaps, drift, staleness, and state inconsistencies")
    .option("--json", "Output raw JSON report")
    .action(async (opts) => {
      const store = await getStore();

      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const report = await runMonitor(store);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printMonitorReport(report);
      }
    });
}
