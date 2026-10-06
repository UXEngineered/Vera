import { useEffect, useMemo, useRef, useState } from "react";
import { checkLanguage, CONTESTED_CAP } from "../confidence/rules.ts";
import { formatIssues, profileEvidence, validateEvidenceLog } from "../evidence/validate.ts";
import {
  confidenceLabel,
  READINESS,
  RequestError,
  SOURCE_LABELS,
  streamGenerate,
  toMarkdown,
  type CheckIssue,
  type Claim,
  type Deliverable,
  type EvidenceItem,
  type EvidenceLog,
  type EvidenceProfile,
  type RawSection,
  type ReviewState,
  type SampleSummary,
  type ServerConfig,
  type StreamEvent,
} from "./lib.ts";

type DeliverableId = "strategy" | "roadmap";
type Source = { kind: "sample"; name: SampleSummary["name"] } | { kind: "custom" };

interface Run {
  status: "streaming" | "done" | "failed" | "error";
  deliverableId: DeliverableId;
  log?: EvidenceLog;
  profile?: EvidenceProfile;
  recorded?: boolean;
  notice?: string;
  model?: string;
  promptVersions?: string[];
  attempt: number;
  maxAttempts: number;
  drafts: RawSection[];
  retries: { attempt: number; issues: CheckIssue[] }[];
  deliverable?: Deliverable;
  issues?: CheckIssue[];
  error?: string;
  errorIssues?: { path: string; message: string }[];
  usage?: { input_tokens: number; output_tokens: number; latency_ms: number };
  attempts?: number;
}

const SECTION_TITLES: Record<string, string> = {
  problem: "Problem",
  opportunity: "Opportunity",
  direction: "Strategic direction",
  risks: "Risks and open questions",
  now: "Now",
  next: "Next",
  later: "Later",
};

const EMPTY_REVIEW: ReviewState = { approved: {}, edits: {} };

export function App() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [source, setSource] = useState<Source>({ kind: "sample", name: "strong" });
  const [customText, setCustomText] = useState("");
  const [deliverableId, setDeliverableId] = useState<DeliverableId>("strategy");
  const [run, setRun] = useState<Run | null>(null);
  const [review, setReview] = useState<ReviewState>(EMPTY_REVIEW);
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [tab, setTab] = useState<"trace" | "gaps" | "conflicts">("trace");
  const [showHow, setShowHow] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const traceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json() as Promise<ServerConfig>).then(setConfig).catch(() => {});
    fetch("/api/samples").then((r) => r.json() as Promise<SampleSummary[]>).then(setSamples).catch(() => {});
  }, []);

  const sample = source.kind === "sample" ? samples.find((s) => s.name === source.name) : undefined;

  // Validate a pasted log in the browser, with the same schema the server uses.
  const custom = useMemo(() => {
    if (source.kind !== "custom" || !customText.trim()) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(customText);
    } catch (e) {
      return { ok: false as const, message: `Not valid JSON: ${(e as Error).message}` };
    }
    const r = validateEvidenceLog(raw);
    return r.ok ? { ok: true as const, log: r.log, profile: profileEvidence(r.log) } : { ok: false as const, message: formatIssues(r.issues) };
  }, [source.kind, customText]);

  const previewLog = run?.log ?? (source.kind === "sample" ? sample?.log : custom?.ok ? custom.log : undefined);
  const evidenceById = useMemo(() => new Map((previewLog?.items ?? []).map((i) => [i.id, i])), [previewLog]);

  const canGenerate =
    run?.status !== "streaming" &&
    (source.kind === "sample" ? Boolean(sample) && (config?.live || config?.recorded[source.name]?.includes(deliverableId)) : Boolean(custom?.ok) && config?.live);

  async function generate(mode?: "recorded") {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReview(EMPTY_REVIEW);
    setEditing(null);
    setSelectedClaim(null);
    setTab("trace");
    setRun({ status: "streaming", deliverableId, attempt: 0, maxAttempts: 0, drafts: [], retries: [] });

    const body = source.kind === "sample" ? { sample: source.name, deliverable: deliverableId, mode } : { log: custom?.ok ? custom.log : null, deliverable: deliverableId };
    const update = (fn: (r: Run) => Run) => setRun((r) => (r ? fn(r) : r));
    try {
      await streamGenerate(
        body,
        (e: StreamEvent) => {
          switch (e.type) {
            case "meta":
              return update((r) => ({ ...r, recorded: e.recorded, notice: e.notice, log: e.log }));
            case "start":
              return update((r) => ({ ...r, profile: e.profile, model: e.model, promptVersions: e.prompt_versions }));
            case "attempt":
              return update((r) => ({ ...r, attempt: e.attempt, maxAttempts: e.max_attempts, drafts: [] }));
            case "draft_section":
              return update((r) => ({ ...r, drafts: [...r.drafts, e.section] }));
            case "retry":
              return update((r) => ({ ...r, retries: [...r.retries, { attempt: e.attempt, issues: e.issues }] }));
            case "done":
              // On thin evidence the gaps are the useful output, so lead with them.
              if (e.deliverable.readiness === "insufficient_evidence") setTab("gaps");
              return update((r) => ({ ...r, status: "done", deliverable: e.deliverable, usage: e.usage, attempts: e.attempts }));
            case "failed":
              return update((r) => ({ ...r, status: "failed", issues: e.issues, attempts: e.attempts }));
            case "error":
              return update((r) => ({ ...r, status: "error", error: e.message }));
          }
        },
        controller.signal,
      );
      update((r) => (r.status === "streaming" ? { ...r, status: "error", error: "The connection closed before VERA finished." } : r));
    } catch (err) {
      if (controller.signal.aborted) return;
      update((r) => ({
        ...r,
        status: "error",
        error: (err as Error).message,
        errorIssues: err instanceof RequestError ? err.issues : undefined,
      }));
    }
  }

  const d = run?.deliverable;
  const claimsById = useMemo(() => new Map((d?.sections ?? []).flatMap((s) => s.claims).map((c) => [c.id, c])), [d]);
  const claim = selectedClaim ? claimsById.get(selectedClaim) : undefined;
  const approvedCount = d ? d.sections.filter((s) => review.approved[s.id]).length : 0;
  const allApproved = Boolean(d) && approvedCount === d!.sections.length;
  const clientName = run?.log?.client.name ?? previewLog?.client.name ?? "";
  const docTitle = run ? (run.deliverableId === "strategy" ? "Product strategy" : "Roadmap") : "";

  function selectClaim(id: string) {
    setSelectedClaim((cur) => (cur === id ? null : id));
    setTab("trace");
    if (window.matchMedia("(max-width: 1100px)").matches) {
      setTimeout(() => traceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  function exportMarkdown() {
    if (!d) return;
    const md = toMarkdown(d, docTitle, clientName, review, run?.model ?? "");
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vera-${run!.deliverableId}-${clientName.toLowerCase().replace(/\W+/g, "-")}${allApproved ? "" : "-draft"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="wordmark">VERA</div>
          <div className="tagline">validated evidence → ready artifacts</div>
        </div>
        <div className="topbar-right">
          {config && (
            <span className={`chip ${config.live ? "chip-live" : ""}`} title={config.model ?? undefined}>
              {config.live ? `Live · ${config.model?.split("/")[1]}` : "Recorded runs only"}
            </span>
          )}
          <button className="link-button" onClick={() => setShowHow((v) => !v)} aria-expanded={showHow}>
            How it works
          </button>
        </div>
      </header>

      <div className="principle">
        <strong>VERA proposes. You decide.</strong> Every claim cites its evidence, confidence carries into the wording, and nothing is
        final until a person approves each section.
      </div>

      {showHow && <HowItWorks onClose={() => setShowHow(false)} />}

      <main className="layout">
        {/* ── Left: inputs + evidence ─────────────────────────── */}
        <aside className="panel panel-left" aria-label="Evidence">
          <h2 className="step">
            <span>1</span> Evidence log
          </h2>
          <div className="sample-list" role="radiogroup" aria-label="Evidence log">
            {samples.map((s) => (
              <button
                key={s.name}
                role="radio"
                aria-checked={source.kind === "sample" && source.name === s.name}
                className={`sample ${source.kind === "sample" && source.name === s.name ? "is-selected" : ""}`}
                onClick={() => setSource({ kind: "sample", name: s.name })}
                disabled={run?.status === "streaming"}
              >
                <span className="sample-head">
                  <span className="sample-label">{s.label}</span>
                  <ConfidenceBar profile={s.profile} />
                </span>
                <span className="sample-client">{s.log.client.name}</span>
                <span className="sample-blurb">{s.blurb}</span>
              </button>
            ))}
            <button
              role="radio"
              aria-checked={source.kind === "custom"}
              className={`sample ${source.kind === "custom" ? "is-selected" : ""}`}
              onClick={() => setSource({ kind: "custom" })}
              disabled={run?.status === "streaming"}
            >
              <span className="sample-label">Paste your own</span>
              <span className="sample-blurb">{config?.live ? "Any log that matches the schema." : "Needs live generation, which is off on this server."}</span>
            </button>
          </div>

          {source.kind === "custom" && (
            <div className="custom">
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder='{"schema_version": "1", "client": {...}, "engagement": {...}, "items": [...]}'
                spellCheck={false}
                aria-label="Custom evidence log JSON"
              />
              <div className="custom-actions">
                <button className="link-button" onClick={() => samples[0] && setCustomText(JSON.stringify(samples[0].log, null, 2))}>
                  Start from the strong sample
                </button>
              </div>
              {custom && !custom.ok && <pre className="validation-error">{custom.message}</pre>}
              {custom?.ok && (
                <p className="validation-ok">
                  ✓ Valid · {custom.profile.total} items · {READINESS[custom.profile.readiness].label.toLowerCase()}
                </p>
              )}
            </div>
          )}

          <h2 className="step">
            <span>2</span> Deliverable
          </h2>
          <div className="segmented" role="radiogroup" aria-label="Deliverable">
            {(config?.deliverables ?? [{ id: "strategy", title: "Product strategy" }, { id: "roadmap", title: "Roadmap" }]).map((dl) => (
              <button
                key={dl.id}
                role="radio"
                aria-checked={deliverableId === dl.id}
                className={deliverableId === dl.id ? "is-selected" : ""}
                onClick={() => setDeliverableId(dl.id)}
                disabled={run?.status === "streaming"}
              >
                {dl.title}
              </button>
            ))}
          </div>

          <button className="primary" disabled={!canGenerate} onClick={() => generate()}>
            {run?.status === "streaming" ? "Generating…" : `Generate ${deliverableId === "strategy" ? "strategy" : "roadmap"}`}
          </button>
          {config?.live && source.kind === "sample" && config.recorded[source.name]?.includes(deliverableId) && run?.status !== "streaming" && (
            <button className="link-button replay-link" onClick={() => generate("recorded")}>
              or replay a recorded run
            </button>
          )}

          {previewLog && (
            <EvidenceList
              log={previewLog}
              highlight={new Set(claim?.evidence_ids ?? [])}
              conflicted={new Set((run?.profile ?? (source.kind === "sample" ? sample?.profile : custom?.ok ? custom.profile : undefined))?.conflictPairs.flat() ?? [])}
            />
          )}
        </aside>

        {/* ── Centre: the document ─────────────────────────────── */}
        <section className="doc" aria-live="polite" aria-busy={run?.status === "streaming"}>
          {!run && <EmptyState />}
          {run && (
            <>
              <div className="doc-head">
                <div>
                  <div className="doc-eyebrow">{clientName}</div>
                  <h1 className="doc-title">{docTitle}</h1>
                </div>
                {d && (
                  <div className={`doc-status ${allApproved ? "is-final" : ""}`}>
                    {allApproved ? "Final · approved by you" : `Draft · ${approvedCount} of ${d.sections.length} sections approved`}
                  </div>
                )}
              </div>

              {run.notice && <div className="notice">{run.notice}</div>}
              <Progress run={run} />

              {run.status === "streaming" && run.drafts.length > 0 && (
                <div className="drafts" aria-label="Unchecked draft">
                  {run.drafts.map((s) => (
                    <DraftSection key={s.id} section={s} />
                  ))}
                </div>
              )}

              {(run.status === "failed" || run.status === "error") && <Failure run={run} />}

              {d && (
                <>
                  <Readiness d={d} profile={run.profile} />
                  {d.sections.map((s) => (
                    <article key={s.id} className={`section ${review.approved[s.id] ? "is-approved" : ""}`}>
                      <header className="section-head">
                        <h2>{s.title}</h2>
                        <div className="section-actions">
                          {review.approved[s.id] ? (
                            <>
                              <span className="approved-badge">✓ Approved {new Date(review.approved[s.id]!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              <button className="ghost" onClick={() => setReview((r) => ({ ...r, approved: omit(r.approved, s.id) }))}>
                                Reopen
                              </button>
                            </>
                          ) : editing === s.id ? (
                            <button className="ghost" onClick={() => setEditing(null)}>
                              Done editing
                            </button>
                          ) : (
                            <>
                              <button className="ghost" onClick={() => setEditing(s.id)} disabled={s.claims.length === 0}>
                                Edit
                              </button>
                              <button className="approve" onClick={() => setReview((r) => ({ ...r, approved: { ...r.approved, [s.id]: new Date().toISOString() } }))}>
                                Approve section
                              </button>
                            </>
                          )}
                        </div>
                      </header>
                      {s.claims.length === 0 && <p className="section-empty">Not enough evidence to write this section. {s.note}</p>}
                      <ul className="claims">
                        {s.claims.map((c) => (
                          <li key={c.id}>
                            {editing === s.id ? (
                              <ClaimEditor claim={c} value={review.edits[c.id] ?? c.text} onChange={(v) => setReview((r) => ({ ...r, edits: v === c.text ? omit(r.edits, c.id) : { ...r.edits, [c.id]: v } }))} />
                            ) : (
                              <ClaimView claim={c} text={review.edits[c.id] ?? c.text} edited={c.id in review.edits} selected={selectedClaim === c.id} onSelect={() => selectClaim(c.id)} />
                            )}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                  <footer className="doc-foot">
                    <button className="ghost" onClick={exportMarkdown}>
                      Export Markdown{allApproved ? "" : " (draft)"}
                    </button>
                    <RunMeta run={run} />
                  </footer>
                </>
              )}
            </>
          )}
        </section>

        {/* ── Right: trace, gaps, conflicts ─────────────────────── */}
        <aside className="panel panel-right" aria-label="Trust panel" ref={traceRef}>
          <div className="tabs" role="tablist">
            {(["trace", "gaps", "conflicts"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-selected" : ""} onClick={() => setTab(t)}>
                {t === "trace" ? "Trace" : t === "gaps" ? `Gaps${d ? ` · ${d.gaps.length}` : ""}` : `Conflicts${d ? ` · ${d.conflicts.length}` : ""}`}
              </button>
            ))}
          </div>
          {tab === "trace" && <TracePanel claim={claim} evidenceById={evidenceById} hasDoc={Boolean(d)} />}
          {tab === "gaps" && <GapsPanel d={d} evidenceById={evidenceById} />}
          {tab === "conflicts" && <ConflictsPanel d={d} evidenceById={evidenceById} />}
        </aside>
      </main>
    </div>
  );
}

function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = obj;
  return rest;
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function ConfidenceBar({ profile }: { profile: EvidenceProfile }) {
  const { high, medium, low } = profile.byConfidence;
  const total = profile.total || 1;
  return (
    <span className="cbar" title={`${high} high · ${medium} medium · ${low} low`} aria-label={`${high} high, ${medium} medium, ${low} low confidence items`}>
      <span className="cbar-high" style={{ flexGrow: high / total }} />
      <span className="cbar-medium" style={{ flexGrow: medium / total }} />
      <span className="cbar-low" style={{ flexGrow: low / total }} />
    </span>
  );
}

function ConfidenceTag({ level }: { level: "high" | "medium" | "low" }) {
  return <span className={`ctag ctag-${level}`}>{confidenceLabel(level)}</span>;
}

function EvidenceList({ log, highlight, conflicted }: { log: EvidenceLog; highlight: Set<string>; conflicted: Set<string> }) {
  // Open beside the document on wide screens; collapsed on narrow ones so the document isn't pushed down.
  const [open] = useState(() => !window.matchMedia("(max-width: 1100px)").matches);
  return (
    <details className="evidence" open={open}>
      <summary className="panel-title">
        Evidence <span className="muted">· {log.items.length} items</span>
      </summary>
      <ul>
        {log.items.map((item) => (
          <li key={item.id} className={`ev ev-${item.confidence} ${highlight.has(item.id) ? "is-cited" : ""} ${highlight.size && !highlight.has(item.id) ? "is-dim" : ""}`}>
            <div className="ev-head">
              <span className="ev-id">{item.id}</span>
              <span className="ev-source">{SOURCE_LABELS[item.source_type] ?? item.source_type}</span>
              {conflicted.has(item.id) && <span className="contested-tag">Contested</span>}
              <ConfidenceDot level={item.confidence} />
            </div>
            <p>{item.summary}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ConfidenceDot({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span className={`cdot cdot-${level}`} title={`${level} confidence`}>
      <span className="sr-only">{level} confidence</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h1>Pick an evidence log and generate.</h1>
      <p>
        Try <strong>Strong evidence</strong> first, click any claim to see what it rests on, then switch to <strong>Thin evidence</strong> and watch VERA hold back.
      </p>
      <ol className="legend">
        <li>
          <span className="claim-sample claim-high">Committed</span> high-confidence evidence; stated directly
        </li>
        <li>
          <span className="claim-sample claim-medium">Likely</span> medium or contested evidence; hedged
        </li>
        <li>
          <span className="claim-sample claim-low">Hypothesis to test</span> low-confidence evidence; framed as a test
        </li>
      </ol>
    </div>
  );
}

function Progress({ run }: { run: Run }) {
  if (run.status !== "streaming" && run.retries.length === 0) return null;
  let label = "Reading the evidence…";
  if (run.attempt > 0) {
    label = run.drafts.length ? `Drafting · ${run.drafts.length} section${run.drafts.length > 1 ? "s" : ""} so far` : run.attempt > 1 ? "Revising…" : "Drafting…";
    if (run.attempt > 1) label += ` · attempt ${run.attempt} of ${run.maxAttempts}`;
  }
  return (
    <div className="progress">
      {run.status === "streaming" && (
        <div className="progress-line">
          <span className="pulse" aria-hidden /> {label}
        </div>
      )}
      {run.retries.map((r) => (
        <details key={r.attempt} className="retry">
          <summary>
            Attempt {r.attempt} failed {r.issues.length} check{r.issues.length > 1 ? "s" : ""}. VERA sent the failures back to the model to fix.
          </summary>
          <IssueList issues={r.issues} />
        </details>
      ))}
    </div>
  );
}

function IssueList({ issues }: { issues: CheckIssue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n}>
          <span className="issue-kind">{i.check}</span> {i.message}
        </li>
      ))}
    </ul>
  );
}

function DraftSection({ section }: { section: RawSection }) {
  return (
    <div className="draft">
      <div className="draft-label">Unchecked draft</div>
      <h2>{SECTION_TITLES[section.id] ?? section.id}</h2>
      <ul>
        {(section.claims ?? []).map((c, i) => (
          <li key={i}>{c.text}</li>
        ))}
      </ul>
      {(section.claims ?? []).length === 0 && section.note && <p className="section-empty">{section.note}</p>}
    </div>
  );
}

function Failure({ run }: { run: Run }) {
  return (
    <div className="failure" role="alert">
      <h2>{run.status === "failed" ? "VERA couldn't produce a draft that passes its checks." : "Something went wrong."}</h2>
      <p>{run.status === "failed" ? `After ${run.attempts} attempts the output still broke these rules, so VERA isn't showing it.` : run.error}</p>
      {run.issues && <IssueList issues={run.issues} />}
      {run.errorIssues && <pre className="validation-error">{formatIssues(run.errorIssues)}</pre>}
    </div>
  );
}

function Readiness({ d, profile }: { d: Deliverable; profile?: EvidenceProfile }) {
  const r = READINESS[d.readiness];
  return (
    <div className={`readiness readiness-${d.readiness}`}>
      <div className="readiness-label">{r.label}</div>
      <div className="readiness-detail">
        {r.detail}
        {profile && profile.reasons.length > 0 && <span className="muted"> ({profile.reasons.join("; ")})</span>}
      </div>
    </div>
  );
}

function ClaimView({ claim, text, edited, selected, onSelect }: { claim: Claim; text: string; edited: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`claim claim-${claim.confidence} ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="claim-meta">
        <ConfidenceTag level={claim.confidence} />
        {claim.action && <span className={`action action-${claim.action}`}>{claim.action}</span>}
        {claim.contested && <span className="contested-tag">Contested</span>}
        {edited && <span className="edited-tag">Edited</span>}
      </span>
      <span className="claim-text">{text}</span>
      <span className="claim-cites">
        {claim.evidence_ids.map((id) => (
          <span key={id} className="cite">
            {id}
          </span>
        ))}
      </span>
    </button>
  );
}

function ClaimEditor({ claim, value, onChange }: { claim: Claim; value: string; onChange: (v: string) => void }) {
  const warnings = checkLanguage(value, claim.confidence);
  return (
    <div className={`claim claim-${claim.confidence} is-editing`}>
      <span className="claim-meta">
        <ConfidenceTag level={claim.confidence} />
        {claim.action && <span className={`action action-${claim.action}`}>{claim.action}</span>}
      </span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} aria-label={`Edit claim ${claim.id}`} />
      {warnings.length > 0 && (
        <p className="edit-warning">
          This wording reads as more certain than the evidence ({confidenceLabel(claim.confidence).toLowerCase()}): {warnings.map((w) => w.detail).join("; ")}. You can keep it; you decide.
        </p>
      )}
    </div>
  );
}

function TracePanel({ claim, evidenceById, hasDoc }: { claim?: Claim; evidenceById: Map<string, EvidenceItem>; hasDoc: boolean }) {
  if (!claim) {
    return <p className="panel-hint">{hasDoc ? "Click any claim to see the evidence behind it and how its confidence was set." : "Claims will appear here with the evidence behind them."}</p>;
  }
  const cited = claim.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean) as EvidenceItem[];
  const weakest = cited.reduce<EvidenceItem | undefined>((w, e) => (!w || rank(e.confidence) < rank(w.confidence) ? e : w), undefined);
  const moreCautious = rank(claim.confidence) < rank(claim.derived_confidence);
  return (
    <div className="trace">
      <div className={`trace-claim claim-${claim.confidence}`}>{claim.text}</div>
      <dl className="derivation">
        <dt>Confidence</dt>
        <dd>
          <ConfidenceTag level={claim.confidence} />
        </dd>
        <dt>Why</dt>
        <dd>
          A claim is only as strong as its weakest evidence
          {weakest && (
            <>
              : <strong>{weakest.id}</strong> is {weakest.confidence}
            </>
          )}
          .
          {claim.contested && <> It rests on contested evidence, so it is capped at {confidenceLabel(CONTESTED_CAP).toLowerCase()}.</>}
          {moreCautious && <> VERA chose wording more cautious than the evidence requires.</>}
        </dd>
      </dl>
      <h3 className="panel-subtitle">Cited evidence · {cited.length}</h3>
      <ul className="trace-evidence">
        {cited.map((e) => (
          <li key={e.id} className={`ev ev-${e.confidence}`}>
            <div className="ev-head">
              <span className="ev-id">{e.id}</span>
              <span className="ev-source">{SOURCE_LABELS[e.source_type] ?? e.source_type}</span>
              <ConfidenceDot level={e.confidence} />
            </div>
            <p>{e.summary}</p>
            <div className="ev-foot">
              {e.source} · {e.date}
            </div>
            {e.conflicts_with.length > 0 && <div className="ev-conflict">Conflicts with {e.conflicts_with.join(", ")}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const rank = (c: "high" | "medium" | "low") => ({ low: 0, medium: 1, high: 2 })[c];

function GapsPanel({ d, evidenceById }: { d?: Deliverable; evidenceById: Map<string, EvidenceItem> }) {
  if (!d) return <p className="panel-hint">After generation, this lists the evidence that's missing and what would raise confidence.</p>;
  if (d.gaps.length === 0) return <p className="panel-hint">VERA found no material evidence gaps for this deliverable.</p>;
  return (
    <ul className="gaps">
      {d.gaps.map((g) => (
        <li key={g.id}>
          <h3>{g.missing}</h3>
          <p>{g.why_it_matters}</p>
          <p className="gap-raise">
            <span>Would raise confidence</span>
            {g.would_raise_confidence}
          </p>
          {g.related_evidence_ids.length > 0 && (
            <div className="claim-cites">
              {g.related_evidence_ids.map((id) => (
                <span key={id} className="cite" title={evidenceById.get(id)?.summary}>
                  {id}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ConflictsPanel({ d, evidenceById }: { d?: Deliverable; evidenceById: Map<string, EvidenceItem> }) {
  if (!d) return <p className="panel-hint">After generation, conflicting evidence is listed here. VERA surfaces conflicts rather than picking a side.</p>;
  if (d.conflicts.length === 0) return <p className="panel-hint">No conflicts in this evidence log.</p>;
  return (
    <ul className="conflicts">
      {d.conflicts.map((c) => (
        <li key={c.id}>
          <div className="conflict-sides">
            {c.evidence_ids.map((id) => {
              const e = evidenceById.get(id);
              return (
                <div key={id} className={`ev ev-${e?.confidence ?? "low"}`}>
                  <div className="ev-head">
                    <span className="ev-id">{id}</span>
                    {e && <ConfidenceDot level={e.confidence} />}
                  </div>
                  <p>{e?.summary}</p>
                </div>
              );
            })}
          </div>
          <p>{c.description}</p>
          <p className="gap-raise">
            <span>To resolve</span>
            {c.how_to_resolve}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RunMeta({ run }: { run: Run }) {
  return (
    <div className="run-meta">
      {run.recorded ? "Recorded run" : "Live run"} · {run.model} · prompts {run.promptVersions?.join(", ")} · {run.attempts} attempt{run.attempts === 1 ? "" : "s"}
      {run.usage && !run.recorded && (
        <>
          {" "}
          · {(run.usage.input_tokens + run.usage.output_tokens).toLocaleString()} tokens · {(run.usage.latency_ms / 1000).toFixed(1)}s
        </>
      )}
    </div>
  );
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <div className="how">
      <ol>
        <li>
          <strong>Validate.</strong> The evidence log is checked against a strict schema. Bad input fails with a clear message.
        </li>
        <li>
          <strong>Profile.</strong> VERA works out the most the log can support: ready, partial, or not enough evidence.
        </li>
        <li>
          <strong>Generate.</strong> The model drafts claims that cite evidence IDs, with wording set by a single confidence table.
        </li>
        <li>
          <strong>Check.</strong> Code, not the model, verifies every citation, derives each claim's confidence from its weakest evidence, rejects
          over-confident wording, and confirms every conflict is surfaced. Failures go back to the model, up to 3 attempts.
        </li>
        <li>
          <strong>Review.</strong> You trace, edit and approve each section. Nothing is final until you do.
        </li>
      </ol>
      <button className="ghost" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
