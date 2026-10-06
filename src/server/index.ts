#!/usr/bin/env bun
import index from "../web/index.html";
import { DELIVERABLES, isDeliverableId } from "../deliverables/specs.ts";
import { validateEvidenceLog } from "../evidence/validate.ts";
import { createProvider, createTraceSink, loadLlmConfig, ReplayProvider, type LlmProvider } from "../llm/index.ts";
import { generateDeliverable, type PipelineEvent } from "../pipeline/generate.ts";
import { RateLimiter } from "./rate-limit.ts";
import { loadRecording, loadSamples, SAMPLE_NAMES, type SampleName } from "./samples.ts";

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const config = loadLlmConfig();
const trace = createTraceSink({ ...config, trace: process.env.VERA_TRACE ? config.trace : "console" });
const samples = loadSamples();
const liveAvailable = Boolean(process.env.ANTHROPIC_API_KEY);
const limiter = new RateLimiter(env("VERA_RATE_LIMIT", 6), env("VERA_RATE_WINDOW_MIN", 60) * 60_000, env("VERA_DAILY_CAP", 300));
const MAX_LOG_BYTES = 64 * 1024;
const MAX_ITEMS = 80;

function clientIp(req: Request, server: Bun.Server<unknown>): string {
  if (process.env.TRUST_PROXY) {
    const forwarded = req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0];
    if (forwarded) return forwarded.trim();
  }
  return server.requestIP(req)?.address ?? "unknown";
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

type GenerateBody = { sample?: string; log?: unknown; deliverable?: string; mode?: "live" | "recorded" };

async function handleGenerate(req: Request, server: Bun.Server<unknown>): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_LOG_BYTES) return json({ error: "Evidence log is too large for the demo (64 KB max)." }, 413);
  let body: GenerateBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  if (!body.deliverable || !isDeliverableId(body.deliverable)) {
    return json({ error: `deliverable must be one of: ${Object.keys(DELIVERABLES).join(", ")}` }, 400);
  }
  const spec = DELIVERABLES[body.deliverable];

  // Resolve the evidence log: a sample by name, or a pasted log validated against the schema.
  let log;
  let sampleName: SampleName | undefined;
  if (body.sample) {
    if (!SAMPLE_NAMES.includes(body.sample as SampleName)) return json({ error: "Unknown sample." }, 400);
    sampleName = body.sample as SampleName;
    log = samples.find((s) => s.name === sampleName)!.log;
  } else {
    const result = validateEvidenceLog(body.log);
    if (!result.ok) return json({ error: "That evidence log doesn't match the schema.", issues: result.issues }, 422);
    if (result.log.items.length > MAX_ITEMS) return json({ error: `The demo accepts up to ${MAX_ITEMS} evidence items.` }, 413);
    log = result.log;
  }

  // Choose live or recorded. Recorded runs are replays of real model output for the samples.
  let provider: LlmProvider;
  let notice: string | undefined;
  const recording = sampleName ? loadRecording(sampleName, spec.id) : null;
  const wantsRecorded = body.mode === "recorded" || !liveAvailable;
  if (wantsRecorded) {
    if (!recording) {
      return json({ error: liveAvailable ? "No recorded run for this sample yet." : "Live generation isn't configured on this server, and only the sample logs have recorded runs." }, 503);
    }
    provider = new ReplayProvider(recording.outputs, recording.model, 25);
    notice = liveAvailable ? "Recorded run (replayed)." : "Live generation isn't configured on this server. Showing a recorded run.";
  } else {
    const limit = limiter.check(clientIp(req, server));
    if (!limit.ok) {
      if (recording) {
        provider = new ReplayProvider(recording.outputs, recording.model, 25);
        notice = `${limit.reason} Showing a recorded run instead.`;
      } else {
        return json({ error: `${limit.reason} Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` }, 429, {
          "retry-after": String(limit.retryAfterSec),
        });
      }
    } else {
      provider = createProvider(config);
    }
  }

  // Stream pipeline events as server-sent events.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PipelineEvent | { type: string; [k: string]: unknown }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client went away
        }
      };
      send({ type: "meta", recorded: provider instanceof ReplayProvider, notice, log });
      try {
        await generateDeliverable({ log, spec, provider, config, trace, onEvent: send, signal: req.signal });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

const server = Bun.serve({
  port: env("PORT", 3000),
  hostname: process.env.HOST ?? "0.0.0.0",
  idleTimeout: 255, // seconds; generations stream for a while
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/api/health": () => json({ ok: true }),
    "/api/config": () =>
      json({
        live: liveAvailable,
        model: liveAvailable ? `${config.provider}/${config.model}` : null,
        deliverables: Object.values(DELIVERABLES).map((d) => ({ id: d.id, title: d.title })),
        recorded: Object.fromEntries(
          SAMPLE_NAMES.map((n) => [n, Object.keys(DELIVERABLES).filter((d) => loadRecording(n, d as "strategy") !== null)]),
        ),
      }),
    "/api/samples": () =>
      json(samples.map(({ name, label, blurb, log, profile }) => ({ name, label, blurb, log, profile }))),
    "/api/generate": { POST: (req, server) => handleGenerate(req, server) },
  },
  fetch: () => json({ error: "Not found" }, 404),
});

console.log(`VERA listening on ${server.url} · ${liveAvailable ? `live (${config.model})` : "recorded runs only (no ANTHROPIC_API_KEY)"}`);
