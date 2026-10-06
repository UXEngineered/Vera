import type { Command } from "commander";
import chalk from "chalk";
import { watch } from "chokidar";
import { getStore, resolveStorePath, loadConfig } from "../config.ts";
import { runMonitor } from "../monitor/index.ts";
import { sendSlackMessage, formatMonitorSlackMessage } from "../communication/slack.ts";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch the evidence store and re-run the monitor on changes")
    .action(async () => {
      const storePath = resolveStorePath();
      const store = await getStore();

      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const config = await loadConfig();
      const debounceMs = config.watch.debounce_ms;

      console.log();
      console.log(chalk.white.bold("VERA Watch Mode"));
      console.log(chalk.dim(`Evidence store: ${storePath}`));
      console.log(chalk.dim(`Debounce:       ${debounceMs}ms`));
      if (config.slack_webhook) {
        console.log(chalk.dim(`Slack:          connected`));
      }
      console.log(chalk.dim(`Press Ctrl+C to stop.\n`));
      console.log(chalk.dim("─".repeat(60)));

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let isProcessing = false;

      const processChange = async (changedPath: string) => {
        if (isProcessing) return;
        isProcessing = true;

        const timestamp = new Date().toLocaleTimeString();

        console.log();
        console.log(chalk.cyan(`[${timestamp}]`) + ` Change detected: ${chalk.white(changedPath.replace(storePath + "/", ""))}`);

        try {
          {
            console.log(chalk.dim("  Running monitor..."));
            const report = await runMonitor(store);

            const totalAlerts =
              report.gaps.length +
              report.drift_warnings.length +
              report.staleness_warnings.length +
              report.state_inconsistencies.length;

            if (totalAlerts > 0) {
              const criticals = report.state_inconsistencies.filter((a) => a.severity === "critical");
              const warnings = report.gaps.length + report.drift_warnings.length + report.staleness_warnings.length;
              console.log(
                `  Monitor: ${criticals.length > 0 ? chalk.red(`${criticals.length} critical`) : ""}${criticals.length > 0 && warnings > 0 ? ", " : ""}${warnings > 0 ? chalk.yellow(`${warnings} warning(s)`) : ""}`,
              );
            } else {
              console.log(chalk.green("  Monitor: healthy, no alerts"));
            }

            // Slack alerts
            if (config.slack_webhook && totalAlerts > 0) {
              const msg = formatMonitorSlackMessage(report);
              await sendSlackMessage(config.slack_webhook, msg);
              console.log(chalk.dim("  Slack: monitor alerts sent"));
            }
          }
        } catch (err) {
          console.error(chalk.red("  Error processing change:"), err);
        } finally {
          isProcessing = false;
          console.log(chalk.dim("─".repeat(60)));
        }
      };

      // Watch the evidence store for direct edits
      const storeWatcher = watch(storePath, {
        ignoreInitial: true,
        ignored: /(^|[\/\\])\../,
      });

      storeWatcher.on("all", (event, path) => {
        if (path.endsWith("manifest.json")) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => processChange(path), debounceMs);
      });


      process.on("SIGINT", () => {
        console.log(chalk.dim("\n\nStopping VERA watch..."));
        storeWatcher.close();
        process.exit(0);
      });
    });
}
