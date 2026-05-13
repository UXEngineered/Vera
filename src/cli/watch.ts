import type { Command } from "commander";
import chalk from "chalk";
import { watch } from "chokidar";
import { mkdir } from "fs/promises";
import { getStore, resolveStorePath, resolveArtifactsPath, loadConfig } from "../config.ts";
import { runMonitor } from "../monitor/index.ts";
import { generateAllArtifacts } from "../generator/artifacts/index.ts";
import { printMonitorReport } from "./monitor.ts";
import {
  sendSlackMessage,
  formatMonitorSlackMessage,
  formatRegenerationSlackMessage,
} from "../communication/slack.ts";
import { ingestCsvFile, moveToProcessed, isSupportedFile } from "../inbox/ingest.ts";
import { basename, join } from "path";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch the evidence store and inbox for changes, auto-import and regenerate artifacts")
    .option("--no-generate", "Only run monitor, skip artifact regeneration")
    .option("--no-monitor", "Only regenerate artifacts, skip monitor")
    .option("--inbox <path>", "Path to inbox folder for CSV ingestion", "inbox")
    .action(async (opts) => {
      const storePath = resolveStorePath();
      const store = await getStore();

      if (!(await store.isInitialized())) {
        console.log(chalk.red("Evidence store not initialized. Run: vera init --engagement <name>"));
        return;
      }

      const config = await loadConfig();
      const artifactsDir = resolveArtifactsPath();
      const debounceMs = config.watch.debounce_ms;

      const inboxPath = opts.inbox.startsWith("/") ? opts.inbox : join(process.cwd(), opts.inbox);
      await mkdir(inboxPath, { recursive: true });
      await mkdir(join(inboxPath, "processed"), { recursive: true });

      console.log();
      console.log(chalk.white.bold("VERA Watch Mode"));
      console.log(chalk.dim(`Evidence store: ${storePath}`));
      console.log(chalk.dim(`Inbox:          ${inboxPath}`));
      console.log(chalk.dim(`Artifacts:      ${config.artifacts_enabled.join(", ")}`));
      console.log(chalk.dim(`Debounce:       ${debounceMs}ms`));
      if (config.slack_webhook) {
        console.log(chalk.dim(`Slack:          connected`));
      }
      console.log(chalk.dim(`\nDrop CSV files into the inbox folder to auto-import.`));
      console.log(chalk.dim(`Press Ctrl+C to stop.\n`));
      console.log(chalk.dim("─".repeat(60)));

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let isProcessing = false;

      const processInboxFile = async (filePath: string): Promise<boolean> => {
        if (!isSupportedFile(filePath)) return false;

        const filename = basename(filePath);
        const timestamp = new Date().toLocaleTimeString();

        console.log();
        console.log(
          chalk.magenta(`[${timestamp}]`) +
            ` Inbox: new file detected → ${chalk.white(filename)}`,
        );

        try {
          const result = await ingestCsvFile(filePath, store);
          console.log(
            chalk.green(`  Imported ${result.imported} ${result.entityType}`) +
              (result.skipped > 0 ? chalk.yellow(` (${result.skipped} skipped)`) : ""),
          );

          const dest = await moveToProcessed(filePath, inboxPath);
          console.log(chalk.dim(`  Moved to processed/`));

          return result.imported > 0;
        } catch (err) {
          console.error(chalk.red(`  Failed to ingest ${filename}:`), err);
          return false;
        }
      };

      const processChange = async (changedPath: string) => {
        if (isProcessing) return;
        isProcessing = true;

        const filename = basename(changedPath);
        const timestamp = new Date().toLocaleTimeString();

        console.log();
        console.log(chalk.cyan(`[${timestamp}]`) + ` Change detected: ${chalk.white(changedPath.replace(storePath + "/", ""))}`);

        try {
          // Run monitor
          if (opts.monitor !== false) {
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

          // Regenerate artifacts
          if (opts.generate !== false) {
            const enabledWithGenerators = config.artifacts_enabled.filter(
              (t) => ["strategy", "roadmap", "scope_check"].includes(t),
            );

            if (enabledWithGenerators.length > 0) {
              console.log(chalk.dim(`  Regenerating artifacts: ${enabledWithGenerators.join(", ")}...`));

              const results = await generateAllArtifacts(
                store,
                { ...config, artifacts_enabled: enabledWithGenerators },
                artifactsDir,
                (type, status, elapsed) => {
                  if (status === "done") {
                    console.log(chalk.green(`    ${type} ✓`) + chalk.dim(` (${elapsed?.toFixed(1)}s)`));
                  } else if (status === "error") {
                    console.log(chalk.red(`    ${type} ✗`));
                  }
                },
              );

              // Slack regeneration notification
              if (config.slack_webhook && results.length > 0) {
                const msg = formatRegenerationSlackMessage(
                  results.map((r) => r.type),
                  [changedPath.replace(storePath + "/", "")],
                );
                await sendSlackMessage(config.slack_webhook, msg);
                console.log(chalk.dim("  Slack: regeneration notified"));
              }
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

      // Watch the inbox folder for new CSV files
      const inboxWatcher = watch(inboxPath, {
        ignoreInitial: true,
        ignored: [/(^|[\/\\])\./, /processed\//],
        depth: 0,
      });

      let inboxDebounce: ReturnType<typeof setTimeout> | null = null;

      inboxWatcher.on("add", (filePath) => {
        if (filePath.includes("/processed/")) return;

        if (inboxDebounce) clearTimeout(inboxDebounce);
        inboxDebounce = setTimeout(async () => {
          const didImport = await processInboxFile(filePath);
          if (didImport) {
            console.log(chalk.dim("  Triggering pipeline from inbox import..."));
            await processChange(filePath);
          }
        }, 1000);
      });

      process.on("SIGINT", () => {
        console.log(chalk.dim("\n\nStopping VERA watch..."));
        storeWatcher.close();
        inboxWatcher.close();
        process.exit(0);
      });
    });
}
