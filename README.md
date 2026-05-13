# Vera

**Validated Evidence → Ready Artifacts**

Vera is a CLI-driven evidence engine that turns structured observations into traceable, honest artifacts. Every claim in a generated document links back to its source evidence. Where evidence is missing, Vera says so.

## What it does

Vera maintains a local evidence store — a structured graph of observations, risks, assumptions, capabilities, and test slices. When you generate artifacts (strategy docs, roadmaps, scope checks), the LLM is constrained by what the evidence actually supports. The result is documents that reflect reality, not aspiration.

```
Evidence → Risks → Assumptions → Test Slices → Decisions → Artifacts
```

A continuous monitor detects gaps, drift (work misaligned with top risks), staleness, and state inconsistencies. Vera will not let a capability reach "commitment" with untested assumptions.

## Architecture

```
src/
├── cli/           Command handlers (init, add, generate, watch, import, ...)
├── generator/     LLM-powered artifact generation with structured prompts
├── monitor/       Gap detection, drift analysis, staleness tracking
├── prompts/       System prompts for each artifact type
├── schema/        Zod schemas for the full data model
├── stacks/        Sync layer — pushes entities to Stacks with lineage
├── store/         JSON file-backed evidence store
├── communication/ Slack notifications
└── config.ts      Configuration resolution
```

### Stacks Integration

When configured, Vera syncs every write to [Stacks](https://github.com/UXEngineered/fieldbook) — the human governance interface for agent-generated work. Evidence becomes sources, risks and assumptions become syntheses, and generated artifacts land with full upstream lineage so humans can trace every claim back to its origin.

## Quick Start

```bash
# Install dependencies
bun install

# Initialize for an engagement
bun run vera init --engagement "Project Name" --weeks 8 --team 3

# Add evidence
bun run vera add evidence \
  --type technical_constraint \
  --source "Architecture Review" \
  --domain feasibility \
  --content "System requires X because Y"

# Add structured entities
bun run vera add capability --name "Feature X" --description "..." --state concept --confidence low
bun run vera add risk --capability CAP-001 --statement "If X then Y because Z" --domain feasibility --impact critical --uncertainty high
bun run vera add assumption --risk RISK-001 --capability CAP-001 --statement "..." --domain feasibility --success "..." --failure "..." --consequence "..."

# Check health
bun run vera status
bun run vera monitor

# Generate artifacts
bun run vera generate artifacts
bun run vera generate artifact --type scope_check

# Generate candidate assumptions for a risk
bun run vera generate assumptions --risk RISK-001

# Watch mode — auto-monitor and regenerate on changes
bun run vera watch

# Import from CSV
bun run vera import --file data.csv --type evidence
```

## Commands

| Command | Description |
|---|---|
| `vera init` | Initialize evidence store for an engagement |
| `vera add <entity>` | Add evidence, risk, assumption, capability, slice, or decision |
| `vera status` | Evidence store health summary |
| `vera monitor` | Detect gaps, drift, staleness, state inconsistencies |
| `vera generate artifacts` | Generate all enabled artifacts |
| `vera generate artifact --type <t>` | Generate a specific artifact |
| `vera generate assumptions --risk <id>` | Generate candidate assumptions for a risk |
| `vera approve assumption --id <id>` | Promote a candidate assumption |
| `vera watch` | Auto-import inbox, monitor, and regenerate on changes |
| `vera import --file <csv> --type <t>` | Bulk import from CSV |

## Data Model

Vera tracks five risk domains across every entity:

| Domain | What it covers |
|---|---|
| **Value** | Will anyone want this? |
| **Usability** | Can people use it effectively? |
| **Feasibility** | Can we build it? |
| **Viability** | Can the business sustain it? |
| **Operational** | Can we run it in production? |

Entities progress through a commitment lifecycle:

```
Concept → Validation → Commitment
```

A capability cannot advance to Commitment if it has untested assumptions. The monitor enforces this.

## Configuration

`vera.config.json`:

```json
{
  "artifacts_enabled": ["strategy", "roadmap", "scope_check"],
  "slack_webhook": "https://hooks.slack.com/...",
  "watch": { "enabled": true, "debounce_ms": 2000 },
  "llm": { "generation_model": "claude-opus-4-5" },
  "stacks": {
    "url": "http://localhost:3000",
    "fieldbook_id": "fb-xxx",
    "sync_enabled": true
  }
}
```

## Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required:
- `ANTHROPIC_API_KEY` — for direct Anthropic API access, or
- `PORTKEY_API_KEY` + `PORTKEY_VIRTUAL_KEY` — for Portkey gateway routing

Optional:
- `SLACK_WEBHOOK_URL` — for monitor/regeneration notifications

## Evidence Types

| Type | Use case |
|---|---|
| `stakeholder_insight` | Interviews, stated needs |
| `user_research` | Observed behavior, usability findings |
| `technical_constraint` | Architecture limits, platform realities |
| `signal` | Quantitative test results, metrics |
| `client_belief` | Client assumptions that need validation |
| `market_signal` | Competitive or market evidence |
| `operational_signal` | Production health, incidents |
| `adoption_metric` | Usage data, retention signals |

## License

Proprietary — UXEngineered
