import { mkdir, readdir, readFile, writeFile, rename, access } from "fs/promises";
import { join } from "path";
import {
  EvidenceEntrySchema,
  RiskSchema,
  AssumptionSchema,
  SliceSchema,
  CapabilitySchema,
  DecisionSchema,
  CandidateAssumptionSchema,
  EngagementContextSchema,
  ManifestSchema,
} from "../schema/index.ts";
import type {
  EvidenceEntry,
  Risk,
  Assumption,
  Slice,
  Capability,
  Decision,
  CandidateAssumption,
  EngagementContext,
  Manifest,
} from "../schema/index.ts";
import type {
  EvidenceStore,
  EvidenceFilter,
  RiskFilter,
  AssumptionFilter,
  SliceFilter,
} from "./types.ts";
import { nextId, now, computeRiskPriority } from "../utils.ts";

const DIRS = [
  "entries",
  "risks",
  "assumptions",
  "slices",
  "capabilities",
  "decisions",
  "candidates",
] as const;

export class JsonEvidenceStore implements EvidenceStore {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async isInitialized(): Promise<boolean> {
    try {
      await access(join(this.basePath, "manifest.json"));
      return true;
    } catch {
      return false;
    }
  }

  async initialize(context?: EngagementContext): Promise<void> {
    for (const dir of DIRS) {
      await mkdir(join(this.basePath, dir), { recursive: true });
    }

    const manifest: Manifest = {
      last_updated: now(),
      entries: [],
    };
    await writeFile(
      join(this.basePath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    if (context) {
      await this.setContext(context);
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private dir(type: string): string {
    return join(this.basePath, type);
  }

  private async loadAll<T>(
    dirName: string,
    schema: { parse: (data: unknown) => T },
  ): Promise<T[]> {
    const dirPath = this.dir(dirName);
    try {
      const files = await readdir(dirPath);
      const items: T[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const raw = await readFile(join(dirPath, file), "utf-8");
        const parsed = schema.parse(JSON.parse(raw));
        items.push(parsed);
      }
      return items;
    } catch {
      return [];
    }
  }

  private async loadOne<T>(
    dirName: string,
    id: string,
    schema: { parse: (data: unknown) => T },
  ): Promise<T | null> {
    try {
      const raw = await readFile(
        join(this.dir(dirName), `${id}.json`),
        "utf-8",
      );
      return schema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async saveOne(dirName: string, id: string, data: unknown): Promise<void> {
    await writeFile(
      join(this.dir(dirName), `${id}.json`),
      JSON.stringify(data, null, 2),
    );
    await this.updateManifest(id, dirName);
  }

  private async updateManifest(id: string, type: string): Promise<void> {
    const manifestPath = join(this.basePath, "manifest.json");
    let manifest: Manifest;
    try {
      const raw = await readFile(manifestPath, "utf-8");
      manifest = ManifestSchema.parse(JSON.parse(raw));
    } catch {
      manifest = { last_updated: now(), entries: [] };
    }

    const existing = manifest.entries.findIndex((e) => e.id === id);
    const entry = {
      id,
      type,
      last_modified: now(),
      file_path: `${type}/${id}.json`,
    };

    if (existing >= 0) {
      manifest.entries[existing] = entry;
    } else {
      manifest.entries.push(entry);
    }
    manifest.last_updated = now();

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  // ─── Evidence Entries ────────────────────────────────────────────────

  async listEvidence(filter?: EvidenceFilter): Promise<EvidenceEntry[]> {
    let items = await this.loadAll("entries", EvidenceEntrySchema);
    if (filter?.domain) items = items.filter((e) => e.domain === filter.domain);
    if (filter?.type) items = items.filter((e) => e.type === filter.type);
    if (filter?.capability_id)
      items = items.filter((e) => e.capability_id === filter.capability_id);
    return items;
  }

  async getEvidence(id: string): Promise<EvidenceEntry | null> {
    return this.loadOne("entries", id, EvidenceEntrySchema);
  }

  async addEvidence(entry: Omit<EvidenceEntry, "id">): Promise<EvidenceEntry> {
    const id = await nextId(this.dir("entries"), "EV");
    const full = EvidenceEntrySchema.parse({ ...entry, id });
    await this.saveOne("entries", id, full);
    return full;
  }

  // ─── Risks ───────────────────────────────────────────────────────────

  async listRisks(filter?: RiskFilter): Promise<Risk[]> {
    let items = await this.loadAll("risks", RiskSchema);
    if (filter?.domain) items = items.filter((r) => r.domain === filter.domain);
    if (filter?.status) items = items.filter((r) => r.status === filter.status);
    if (filter?.capability_id)
      items = items.filter((r) => r.capability_id === filter.capability_id);
    return items;
  }

  async getRisk(id: string): Promise<Risk | null> {
    return this.loadOne("risks", id, RiskSchema);
  }

  async addRisk(
    risk: Omit<Risk, "id" | "created_date" | "updated_date" | "priority_score">,
  ): Promise<Risk> {
    const id = await nextId(this.dir("risks"), "RISK");
    const timestamp = now();
    const priority_score = computeRiskPriority(
      risk.impact,
      risk.uncertainty,
      risk.test_cost,
    );
    const full = RiskSchema.parse({
      ...risk,
      id,
      created_date: timestamp,
      updated_date: timestamp,
      priority_score,
    });
    await this.saveOne("risks", id, full);
    return full;
  }

  // ─── Assumptions ─────────────────────────────────────────────────────

  async listAssumptions(filter?: AssumptionFilter): Promise<Assumption[]> {
    let items = await this.loadAll("assumptions", AssumptionSchema);
    if (filter?.status)
      items = items.filter((a) => a.status === filter.status);
    if (filter?.domain)
      items = items.filter((a) => a.domain === filter.domain);
    if (filter?.capability_id)
      items = items.filter((a) => a.capability_id === filter.capability_id);
    if (filter?.risk_id)
      items = items.filter((a) => a.risk_id === filter.risk_id);
    return items;
  }

  async getAssumption(id: string): Promise<Assumption | null> {
    return this.loadOne("assumptions", id, AssumptionSchema);
  }

  async addAssumption(
    assumption: Omit<Assumption, "id" | "created_date" | "updated_date">,
  ): Promise<Assumption> {
    const id = await nextId(this.dir("assumptions"), "ASM");
    const timestamp = now();
    const full = AssumptionSchema.parse({
      ...assumption,
      id,
      created_date: timestamp,
      updated_date: timestamp,
    });
    await this.saveOne("assumptions", id, full);
    return full;
  }

  async updateAssumption(
    id: string,
    updates: Partial<Assumption>,
  ): Promise<Assumption> {
    const existing = await this.getAssumption(id);
    if (!existing) throw new Error(`Assumption ${id} not found`);
    const updated = AssumptionSchema.parse({
      ...existing,
      ...updates,
      id: existing.id,
      updated_date: now(),
    });
    await this.saveOne("assumptions", id, updated);
    return updated;
  }

  // ─── Slices ──────────────────────────────────────────────────────────

  async listSlices(filter?: SliceFilter): Promise<Slice[]> {
    let items = await this.loadAll("slices", SliceSchema);
    if (filter?.status)
      items = items.filter((s) => s.status === filter.status);
    if (filter?.assumption_id)
      items = items.filter((s) => s.assumption_id === filter.assumption_id);
    return items;
  }

  async getSlice(id: string): Promise<Slice | null> {
    return this.loadOne("slices", id, SliceSchema);
  }

  async addSlice(
    slice: Omit<Slice, "id" | "created_date">,
  ): Promise<Slice> {
    const id = await nextId(this.dir("slices"), "SLC");
    const full = SliceSchema.parse({
      ...slice,
      id,
      created_date: now(),
    });
    await this.saveOne("slices", id, full);
    return full;
  }

  // ─── Capabilities ────────────────────────────────────────────────────

  async listCapabilities(): Promise<Capability[]> {
    return this.loadAll("capabilities", CapabilitySchema);
  }

  async getCapability(id: string): Promise<Capability | null> {
    return this.loadOne("capabilities", id, CapabilitySchema);
  }

  async addCapability(
    capability: Omit<Capability, "id">,
  ): Promise<Capability> {
    const id = await nextId(this.dir("capabilities"), "CAP");
    const full = CapabilitySchema.parse({ ...capability, id });
    await this.saveOne("capabilities", id, full);
    return full;
  }

  // ─── Decisions ───────────────────────────────────────────────────────

  async listDecisions(): Promise<Decision[]> {
    return this.loadAll("decisions", DecisionSchema);
  }

  async addDecision(
    decision: Omit<Decision, "id">,
  ): Promise<Decision> {
    const id = await nextId(this.dir("decisions"), "DEC");
    const full = DecisionSchema.parse({ ...decision, id });
    await this.saveOne("decisions", id, full);
    return full;
  }

  // ─── Candidates ──────────────────────────────────────────────────────

  async listCandidates(): Promise<CandidateAssumption[]> {
    return this.loadAll("candidates", CandidateAssumptionSchema);
  }

  async getCandidate(id: string): Promise<CandidateAssumption | null> {
    return this.loadOne("candidates", id, CandidateAssumptionSchema);
  }

  async addCandidate(
    candidate: Omit<CandidateAssumption, "id" | "created_date">,
  ): Promise<CandidateAssumption> {
    const id = await nextId(this.dir("candidates"), "CAND");
    const full = CandidateAssumptionSchema.parse({
      ...candidate,
      id,
      created_date: now(),
    });
    await this.saveOne("candidates", id, full);
    return full;
  }

  async approveCandidate(id: string): Promise<Assumption> {
    const candidate = await this.getCandidate(id);
    if (!candidate) throw new Error(`Candidate ${id} not found`);

    const assumption = await this.addAssumption({
      risk_id: candidate.risk_id,
      statement: candidate.statement,
      domain: candidate.domain,
      status: "untested",
      confidence: "low",
      success_criteria: candidate.success_criteria,
      failure_criteria: candidate.failure_criteria,
      decision_consequence: candidate.decision_consequence,
      linked_evidence: [],
      linked_slices: [],
      capability_id: candidate.capability_id,
    });

    // Remove candidate file
    const { unlink } = await import("fs/promises");
    try {
      await unlink(join(this.dir("candidates"), `${id}.json`));
    } catch {}

    return assumption;
  }

  // ─── Context ─────────────────────────────────────────────────────────

  async getContext(): Promise<EngagementContext | null> {
    try {
      const raw = await readFile(
        join(this.basePath, "context.json"),
        "utf-8",
      );
      return EngagementContextSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async setContext(context: EngagementContext): Promise<void> {
    const validated = EngagementContextSchema.parse(context);
    await writeFile(
      join(this.basePath, "context.json"),
      JSON.stringify(validated, null, 2),
    );
  }

  // ─── Manifest ────────────────────────────────────────────────────────

  async getManifest(): Promise<Manifest> {
    try {
      const raw = await readFile(
        join(this.basePath, "manifest.json"),
        "utf-8",
      );
      return ManifestSchema.parse(JSON.parse(raw));
    } catch {
      return { last_updated: now(), entries: [] };
    }
  }
}
