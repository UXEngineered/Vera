import type { MonitorReport, Alert } from "../schema/index.ts";

function severityEmoji(severity: string): string {
  switch (severity) {
    case "critical": return "🚨";
    case "warning": return "⚠️";
    case "info": return "ℹ️";
    default: return "•";
  }
}

function formatAlertBlock(alert: Alert): string {
  let text = `${severityEmoji(alert.severity)} *${alert.severity.toUpperCase()}* — ${alert.message}`;
  if (alert.suggested_action) {
    text += `\n    → _${alert.suggested_action}_`;
  }
  return text;
}

export function formatMonitorSlackMessage(report: MonitorReport): object {
  const totalAlerts =
    report.gaps.length +
    report.drift_warnings.length +
    report.staleness_warnings.length +
    report.state_inconsistencies.length;

  if (totalAlerts === 0) {
    return {
      text: "✅ VERA Monitor: Evidence store is healthy. No alerts.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "✅ *VERA Monitor* — Evidence store is healthy. No alerts.",
          },
        },
      ],
    };
  }

  const healthEmoji = report.overall_evidence_health === "critical_gaps" ? "🔴" : "🟡";
  const sections: string[] = [];

  sections.push(
    `${healthEmoji} *VERA Monitor Report* — ${totalAlerts} alert(s) detected\nHealth: *${report.overall_evidence_health.replace("_", " ").toUpperCase()}*`,
  );

  if (report.state_inconsistencies.length > 0) {
    const items = report.state_inconsistencies.map(formatAlertBlock).join("\n");
    sections.push(`*State Inconsistencies*\n${items}`);
  }

  // Consolidate gaps: show critical/warning per-capability, skip per-domain noise
  const importantGaps = report.gaps.filter(
    (g) => g.severity === "critical" || g.severity === "warning",
  );
  if (importantGaps.length > 0) {
    const domainGaps = importantGaps.filter((g) => g.entity_type === "domain");
    const otherGaps = importantGaps.filter((g) => g.entity_type !== "domain");

    const items: string[] = [];
    for (const g of otherGaps.slice(0, 5)) {
      items.push(formatAlertBlock(g));
    }
    if (domainGaps.length > 0) {
      const domains = domainGaps.map((g) => g.entity_id).join(", ");
      items.push(`⚠️ *WARNING* — No evidence in domain(s): ${domains}`);
    }
    if (importantGaps.length > 5 + domainGaps.length) {
      items.push(`_...and ${importantGaps.length - 5 - domainGaps.length} more gap(s)_`);
    }
    sections.push(`*Evidence Gaps*\n${items.join("\n")}`);
  }

  if (report.drift_warnings.length > 0) {
    const items = report.drift_warnings.slice(0, 3).map(formatAlertBlock).join("\n");
    sections.push(`*Drift Warnings*\n${items}`);
  }

  if (report.staleness_warnings.length > 0) {
    const items = report.staleness_warnings.slice(0, 3).map(formatAlertBlock).join("\n");
    sections.push(`*Staleness Warnings*\n${items}`);
  }

  return {
    text: `VERA Monitor: ${totalAlerts} alert(s) — ${report.overall_evidence_health}`,
    blocks: sections.map((text) => ({
      type: "section",
      text: { type: "mrkdwn", text },
    })),
  };
}

export function formatRegenerationSlackMessage(
  artifactTypes: string[],
  changedEntities: string[],
): object {
  const artifacts = artifactTypes.join(", ");
  const changes = changedEntities.length > 0
    ? `Triggered by: ${changedEntities.join(", ")}`
    : "";

  return {
    text: `📄 VERA: Artifacts regenerated (${artifacts})`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📄 *Artifacts regenerated:* ${artifacts}\n${changes}`,
        },
      },
    ],
  };
}

export async function sendSlackMessage(
  webhookUrl: string,
  message: object,
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    return response.ok;
  } catch (err) {
    console.error("Slack webhook failed:", err);
    return false;
  }
}
