// ─── Deliverable specs ───────────────────────────────────────────────────────
//
// Each deliverable is a fixed set of sections plus a versioned prompt file.
// Adding a deliverable = adding a spec here and a prompt in prompts/.

export interface SectionSpec {
  id: string;
  title: string;
  purpose: string;
}

export interface DeliverableSpec {
  id: "strategy" | "roadmap" | "eval_suite";
  title: string;
  /** Prompt file in prompts/, versioned by filename. */
  prompt: string;
  sections: SectionSpec[];
  /** Roadmap items must say whether they are build, validate or investigate work. */
  requiresAction: boolean;
  /** Eval suite: every claim is an eval case with a scenario, pass criteria and grader. */
  requiresEvalFields?: boolean;
  /**
   * Shown in the public demo. A deliverable stays private until a live run of it
   * passes the eval suite; it is still available from the CLI.
   */
  public: boolean;
}

export const DELIVERABLES: Record<DeliverableSpec["id"], DeliverableSpec> = {
  strategy: {
    id: "strategy",
    title: "Product strategy",
    prompt: "strategy.v1.md",
    requiresAction: false,
    public: true,
    sections: [
      { id: "problem", title: "Problem", purpose: "What problem the evidence shows, for whom, and how big it is." },
      { id: "opportunity", title: "Opportunity", purpose: "Where the evidence points to value for the client and its users." },
      { id: "direction", title: "Strategic direction", purpose: "What to pursue, and what not to, based on the evidence." },
      { id: "risks", title: "Risks and open questions", purpose: "What could make this direction wrong." },
    ],
  },
  roadmap: {
    id: "roadmap",
    title: "Roadmap",
    prompt: "roadmap.v1.md",
    requiresAction: true,
    public: true,
    sections: [
      { id: "now", title: "Now", purpose: "Work to start immediately." },
      { id: "next", title: "Next", purpose: "Work that follows once 'Now' has landed or been validated." },
      { id: "later", title: "Later", purpose: "Directional items that depend on evidence not yet gathered." },
    ],
  },
  eval_suite: {
    id: "eval_suite",
    title: "Eval suite",
    prompt: "eval_suite.v1.md",
    requiresAction: false,
    requiresEvalFields: true,
    public: false,
    // Sections are the eval roles; a case's section must match the role its confidence allows.
    sections: [
      { id: "regression", title: "Regression", purpose: "Behaviour the evidence firmly supports. Must pass; a failure blocks release." },
      { id: "capability", title: "Capability", purpose: "Behaviour the evidence suggests. Tracked against a threshold; does not block." },
      { id: "exploratory", title: "Exploratory", purpose: "Hypotheses to test, including cases that settle conflicts in the evidence." },
    ],
  },
};

export type DeliverableId = DeliverableSpec["id"];

export const PUBLIC_DELIVERABLES = Object.values(DELIVERABLES).filter((d) => d.public);

export function isDeliverableId(value: string): value is DeliverableId {
  return value in DELIVERABLES;
}
