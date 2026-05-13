/**
 * StacksSyncStore — decorator around JsonEvidenceStore that pushes
 * every write to the Stacks REST API, keeping the local JSON store
 * as the source of truth for Vera's structured data model.
 *
 * Sync failures are logged but never block the local write.
 */

import chalk from "chalk";
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
} from "../store/types.ts";
import type { JsonEvidenceStore } from "../store/json-store.ts";
import { StacksClient } from "./client.ts";
import { IdMap } from "./id-map.ts";
import {
  mapEvidence,
  mapRisk,
  mapAssumption,
  mapCapability,
  mapDecision,
} from "./mapper.ts";

function syncLog(msg: string) {
  console.log(chalk.dim(`  [stacks] ${msg}`));
}

function syncError(msg: string, err: unknown) {
  console.error(chalk.yellow(`  [stacks] ${msg}:`), err instanceof Error ? err.message : err);
}

export class StacksSyncStore implements EvidenceStore {
  readonly basePath: string;

  constructor(
    private inner: JsonEvidenceStore,
    private client: StacksClient,
    private idMap: IdMap,
    private fieldbookId: string,
  ) {
    this.basePath = inner.basePath;
  }

  // ── Write methods: local write + Stacks push ─────────────────────

  async addEvidence(entry: Omit<EvidenceEntry, "id">): Promise<EvidenceEntry> {
    const result = await this.inner.addEvidence(entry);
    try {
      const stacksId = await this.client.createSource(
        this.fieldbookId,
        mapEvidence(result),
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced evidence ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync evidence ${result.id}`, e);
    }
    return result;
  }

  async addRisk(risk: Omit<Risk, "id" | "created_date" | "updated_date" | "priority_score">): Promise<Risk> {
    const result = await this.inner.addRisk(risk);
    try {
      const payload = mapRisk(result);
      const evidenceIds = await this.idMap.resolveMany(result.assumptions);
      payload.derivedFrom = evidenceIds;
      const stacksId = await this.client.createSynthesis(
        this.fieldbookId,
        payload,
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced risk ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync risk ${result.id}`, e);
    }
    return result;
  }

  async addAssumption(assumption: Omit<Assumption, "id" | "created_date" | "updated_date">): Promise<Assumption> {
    const result = await this.inner.addAssumption(assumption);
    try {
      const payload = mapAssumption(result);
      const linkedIds = await this.idMap.resolveMany(result.linked_evidence);
      const riskStacksId = await this.idMap.get(result.risk_id);
      payload.derivedFrom = [...linkedIds, ...(riskStacksId ? [riskStacksId] : [])];
      const stacksId = await this.client.createSynthesis(
        this.fieldbookId,
        payload,
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced assumption ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync assumption ${result.id}`, e);
    }
    return result;
  }

  async updateAssumption(id: string, updates: Partial<Assumption>): Promise<Assumption> {
    return this.inner.updateAssumption(id, updates);
  }

  async addSlice(slice: Omit<Slice, "id" | "created_date">): Promise<Slice> {
    return this.inner.addSlice(slice);
  }

  async addCapability(capability: Omit<Capability, "id">): Promise<Capability> {
    const result = await this.inner.addCapability(capability);
    try {
      const stacksId = await this.client.createSynthesis(
        this.fieldbookId,
        mapCapability(result),
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced capability ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync capability ${result.id}`, e);
    }
    return result;
  }

  async addDecision(decision: Omit<Decision, "id">): Promise<Decision> {
    const result = await this.inner.addDecision(decision);
    try {
      const payload = mapDecision(result);
      const evidenceIds = await this.idMap.resolveMany(result.evidence_ids);
      payload.informedBy = evidenceIds;
      const stacksId = await this.client.createArtifact(
        this.fieldbookId,
        payload,
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced decision ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync decision ${result.id}`, e);
    }
    return result;
  }

  async addCandidate(candidate: Omit<CandidateAssumption, "id" | "created_date">): Promise<CandidateAssumption> {
    return this.inner.addCandidate(candidate);
  }

  async approveCandidate(id: string): Promise<Assumption> {
    const result = await this.inner.approveCandidate(id);
    try {
      const payload = mapAssumption(result);
      const stacksId = await this.client.createSynthesis(
        this.fieldbookId,
        payload,
      );
      await this.idMap.set(result.id, stacksId);
      syncLog(`synced approved assumption ${result.id} → ${stacksId}`);
    } catch (e) {
      syncError(`failed to sync approved assumption ${result.id}`, e);
    }
    return result;
  }

  async setContext(context: EngagementContext): Promise<void> {
    return this.inner.setContext(context);
  }

  // ── Read methods: delegate directly to inner store ────────────────

  listEvidence(filter?: EvidenceFilter): Promise<EvidenceEntry[]> {
    return this.inner.listEvidence(filter);
  }
  getEvidence(id: string): Promise<EvidenceEntry | null> {
    return this.inner.getEvidence(id);
  }
  listRisks(filter?: RiskFilter): Promise<Risk[]> {
    return this.inner.listRisks(filter);
  }
  getRisk(id: string): Promise<Risk | null> {
    return this.inner.getRisk(id);
  }
  listAssumptions(filter?: AssumptionFilter): Promise<Assumption[]> {
    return this.inner.listAssumptions(filter);
  }
  getAssumption(id: string): Promise<Assumption | null> {
    return this.inner.getAssumption(id);
  }
  listSlices(filter?: SliceFilter): Promise<Slice[]> {
    return this.inner.listSlices(filter);
  }
  getSlice(id: string): Promise<Slice | null> {
    return this.inner.getSlice(id);
  }
  listCapabilities(): Promise<Capability[]> {
    return this.inner.listCapabilities();
  }
  getCapability(id: string): Promise<Capability | null> {
    return this.inner.getCapability(id);
  }
  listDecisions(): Promise<Decision[]> {
    return this.inner.listDecisions();
  }
  listCandidates(): Promise<CandidateAssumption[]> {
    return this.inner.listCandidates();
  }
  getCandidate(id: string): Promise<CandidateAssumption | null> {
    return this.inner.getCandidate(id);
  }
  getContext(): Promise<EngagementContext | null> {
    return this.inner.getContext();
  }
  getManifest(): Promise<Manifest> {
    return this.inner.getManifest();
  }
  isInitialized(): Promise<boolean> {
    return this.inner.isInitialized();
  }
}
