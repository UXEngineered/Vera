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
  RiskDomain,
  EvidenceType,
} from "../schema/index.ts";

export interface EvidenceFilter {
  domain?: RiskDomain;
  type?: EvidenceType;
  capability_id?: string;
}

export interface RiskFilter {
  domain?: RiskDomain;
  status?: string;
  capability_id?: string;
}

export interface AssumptionFilter {
  status?: string;
  domain?: RiskDomain;
  capability_id?: string;
  risk_id?: string;
}

export interface SliceFilter {
  status?: string;
  assumption_id?: string;
}

/**
 * Storage abstraction for the evidence store.
 * V1 implements this against JSON files.
 * Future: Stacks API/MCP implementation.
 */
export interface EvidenceStore {
  // Evidence entries
  listEvidence(filter?: EvidenceFilter): Promise<EvidenceEntry[]>;
  getEvidence(id: string): Promise<EvidenceEntry | null>;
  addEvidence(entry: Omit<EvidenceEntry, "id">): Promise<EvidenceEntry>;

  // Risks
  listRisks(filter?: RiskFilter): Promise<Risk[]>;
  getRisk(id: string): Promise<Risk | null>;
  addRisk(risk: Omit<Risk, "id" | "created_date" | "updated_date" | "priority_score">): Promise<Risk>;

  // Assumptions
  listAssumptions(filter?: AssumptionFilter): Promise<Assumption[]>;
  getAssumption(id: string): Promise<Assumption | null>;
  addAssumption(assumption: Omit<Assumption, "id" | "created_date" | "updated_date">): Promise<Assumption>;
  updateAssumption(id: string, updates: Partial<Assumption>): Promise<Assumption>;

  // Slices
  listSlices(filter?: SliceFilter): Promise<Slice[]>;
  getSlice(id: string): Promise<Slice | null>;
  addSlice(slice: Omit<Slice, "id" | "created_date">): Promise<Slice>;

  // Capabilities
  listCapabilities(): Promise<Capability[]>;
  getCapability(id: string): Promise<Capability | null>;
  addCapability(capability: Omit<Capability, "id">): Promise<Capability>;

  // Decisions
  listDecisions(): Promise<Decision[]>;
  addDecision(decision: Omit<Decision, "id">): Promise<Decision>;

  // Candidates
  listCandidates(): Promise<CandidateAssumption[]>;
  getCandidate(id: string): Promise<CandidateAssumption | null>;
  addCandidate(candidate: Omit<CandidateAssumption, "id" | "created_date">): Promise<CandidateAssumption>;
  approveCandidate(id: string): Promise<Assumption>;

  // Engagement context
  getContext(): Promise<EngagementContext | null>;
  setContext(context: EngagementContext): Promise<void>;

  // Manifest
  getManifest(): Promise<Manifest>;

  // Store metadata
  readonly basePath: string;
  isInitialized(): Promise<boolean>;
}
