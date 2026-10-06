# VERA MVP Plan

## Goal

Turn VERA from a CLI that a person drives into infrastructure that any agent can use, with the rules enforced by VERA rather than by the model.

The MVP is done when an agent (Claude Code, Claude Desktop, or any MCP client), running on any supported model, can:

1. Read the evidence store and check whether a claim is supported.
2. Propose new evidence, risks, and assumptions, which land as candidates a human must approve.
3. Generate an artifact where every claim links to evidence and gaps are stated plainly.
4. Get blocked, with a clear reason, when it tries to advance a capability that has untested assumptions.

Every one of those actions leaves a receipt: who did it, when, through which tool, and with what inputs.

## Non-goals for the MVP

Keep these out to avoid scope creep. Each is a reasonable later phase, not an MVP requirement.

- Payments, metering, or billing
- Multi-tenant hosting, user accounts, or auth beyond local use
- New Stacks UI work (keep the existing sync working; don't extend it)
- New artifact types beyond strategy, roadmap, and scope_check
- Integrations beyond file-based ingestion (no Jira, Slack, or Drive connectors yet)

## Target architecture

```
src/
├── core/          NEW  Pure service layer: every operation as a typed function
├── mcp/           NEW  MCP server exposing core operations as tools and resources
├── llm/           NEW  Provider-agnostic model layer (Anthropic, OpenAI, Portkey)
├── ledger/        NEW  Append-only event log (receipts) for every write
├── ingest/        NEW  Extract candidate evidence from transcripts and docs
├── cli/           Thin wrapper over core/
├── generator/     Uses llm/ instead of calling a provider directly
├── monitor/       Unchanged logic; exposed through core/
├── schema/        Extended with candidate status and provenance fields
├── store/         Unchanged JSON store
├── stacks/        Unchanged sync
└── communication/ Unchanged Slack notifications
```

Rule: the CLI and the MCP server both call `core/`. Neither contains business logic.

## Phases

### Phase 0: Repo hygiene

- Decide repo visibility and license (currently public with a proprietary license).
- Add `CLAUDE.md` with project conventions, commands, and the rule that business logic lives in `core/`.
- Set up `bun test` and a basic CI workflow.
- Create a sample engagement dataset in `examples/demo-engagement/` for tests and demos.

Done when: `bun test` runs green in CI against the sample dataset.

### Phase 1: Extract the core service layer

- Move logic out of `cli/` handlers into `core/` functions with Zod-typed inputs and outputs.
- Make the CLI a thin wrapper that parses arguments and calls `core/`.
- Write tests for the invariants that matter most: the commitment gate, gap detection, drift, and staleness.

Done when: every existing CLI command works unchanged and is backed by a tested `core/` function.

### Phase 2: Model-agnostic LLM layer

- Define a small provider interface: generate text and generate structured output against a Zod schema.
- Implement Anthropic, OpenAI, and Portkey providers (consider the Vercel AI SDK to reduce work).
- Extend `vera.config.json`: `llm.provider`, `llm.model`, with environment variables for keys.
- Route `generator/` through `llm/`.
- Add fixture-based tests so generation logic can be tested without live API calls.

Done when: switching providers is a config change and artifact generation passes tests on recorded fixtures.

### Phase 3: Provenance and candidate status

- Add to the schema: `status` (`candidate` | `approved` | `rejected`) and `provenance` (`actor_type` human or agent, `actor_name`, `tool`, `timestamp`, `source_ref`).
- Anything an agent creates starts as `candidate`. Only approved entities count toward artifacts and the commitment gate.
- Extend `vera approve` and add `vera reject` to cover evidence, risks, and assumptions, not just assumptions.
- Add `ledger/`: an append-only JSONL log of every write, with actor, operation, inputs, and result. These are the receipts.
- Add `vera ledger` to view recent entries.

Done when: an agent-created entity cannot influence an artifact until a human approves it, and every write appears in the ledger.

### Phase 4: MCP server

Start with stdio transport for local use with Claude Code and Claude Desktop. Use the official TypeScript MCP SDK.

Read tools:

- `vera_status`: store health summary
- `vera_monitor`: gaps, drift, staleness, and inconsistencies
- `vera_query_evidence`: filter by capability, domain, type, or text
- `vera_check_claim`: given a claim and an optional capability, return the supporting evidence IDs, or "unsupported" with the closest related evidence. This is the core trust tool.

Write tools (all create candidates and write to the ledger):

- `vera_propose_evidence`
- `vera_propose_risk`
- `vera_propose_assumption`

Gated tools:

- `vera_advance_capability`: enforces the commitment gate and returns specific blocking reasons
- `vera_generate_artifact`: generates from approved entities only, with citations inline and a "What the evidence doesn't support" section

Resources:

- The approved evidence store, read-only
- Generated artifacts

Done when: Claude Code connects to the server, uses each tool successfully, and is blocked correctly by the gate.

### Phase 5: Ingestion

- Add `vera ingest --file <path>` for markdown and plain-text transcripts and notes.
- The model extracts candidate evidence, each with the exact source excerpt and location, so a human can verify it.
- Expose the same operation as an MCP tool: `vera_ingest_document`.

Done when: ingesting a sample interview transcript produces candidates with excerpts, and approving them updates the monitor.

### Phase 6: Demo and evaluation

- Script a demo: an agent runs discovery on the sample engagement, proposes evidence, gets blocked at the gate, a human approves candidates, and a cited artifact is generated.
- Measure:

- Share of artifact claims that link to approved evidence (target: 100% or explicitly flagged as unsupported)
- Unsupported claims caught by `vera_check_claim` on a seeded test set
- Results across at least two model providers
- Record a short screen capture for the portfolio and outreach.

Done when: the demo runs end to end on two providers and the metrics are written up.

## Risks

- **Scope creep.** Hold the non-goals list. If a feature doesn't serve the four MVP capabilities, it waits.
- **IP ownership.** VERA started inside an employer initiative. Confirm who owns it before positioning it as a product.
- **Model variance.** Rules live in code, not prompts, so behavior stays consistent across models. Test on at least two.

## First prompt for Claude Code

> Read README.md, this plan, and the src/ directory. Then do Phase 0: propose a CLAUDE.md, set up bun test with a CI workflow, and create a small sample engagement dataset under examples/demo-engagement/. Show me the plan before writing code, and don't start Phase 1 until I approve.
