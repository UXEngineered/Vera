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
  id: "strategy" | "roadmap";
  title: string;
  /** Prompt file in prompts/, versioned by filename. */
  prompt: string;
  sections: SectionSpec[];
  /** Roadmap items must say whether they are build, validate or investigate work. */
  requiresAction: boolean;
}

export const DELIVERABLES: Record<DeliverableSpec["id"], DeliverableSpec> = {
  strategy: {
    id: "strategy",
    title: "Product strategy",
    prompt: "strategy.v1.md",
    requiresAction: false,
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
    sections: [
      { id: "now", title: "Now", purpose: "Work to start immediately." },
      { id: "next", title: "Next", purpose: "Work that follows once 'Now' has landed or been validated." },
      { id: "later", title: "Later", purpose: "Directional items that depend on evidence not yet gathered." },
    ],
  },
};

export type DeliverableId = DeliverableSpec["id"];

export function isDeliverableId(value: string): value is DeliverableId {
  return value in DELIVERABLES;
}
