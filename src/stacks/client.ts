/**
 * Thin HTTP client for the Stacks REST API (v2).
 * All requests include X-Actor to identify Vera as the agent.
 */

export interface StacksSourcePayload {
  title: string;
  content: string;
  type?: string;
  url?: string;
  note?: string;
  tags?: string[];
  status?: string;
  visibility?: string;
}

export interface StacksSynthesisPayload {
  title: string;
  content: string;
  type: string;
  derivedFrom: string[];
  tags?: string[];
  status?: string;
  visibility?: string;
}

export interface StacksArtifactPayload {
  title: string;
  content: string;
  type: string;
  informedBy: string[];
  tags?: string[];
  status?: string;
  visibility?: string;
}

interface StacksOkResponse {
  ok: true;
  data: {
    source?: { id: string; title: string };
    synthesis?: { id: string; title: string };
    artifact?: { id: string; title: string };
  };
}

export class StacksClient {
  private baseUrl: string;
  private actor: string;

  constructor(baseUrl: string, actor = "agent:vera:vera") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.actor = actor;
  }

  private async post(path: string, body: unknown): Promise<StacksOkResponse> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor": this.actor,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Stacks API error ${response.status} on POST ${path}: ${text}`);
    }

    return response.json() as Promise<StacksOkResponse>;
  }

  async createSource(
    fieldbookId: string,
    payload: StacksSourcePayload,
  ): Promise<string> {
    const res = await this.post(
      `/api/v2/fieldbooks/${fieldbookId}/nodes`,
      payload,
    );
    return res.data.source!.id;
  }

  async createSynthesis(
    fieldbookId: string,
    payload: StacksSynthesisPayload,
  ): Promise<string> {
    const res = await this.post(
      `/api/v2/fieldbooks/${fieldbookId}/syntheses`,
      payload,
    );
    return res.data.synthesis!.id;
  }

  async createArtifact(
    fieldbookId: string,
    payload: StacksArtifactPayload,
  ): Promise<string> {
    const res = await this.post(
      `/api/v2/fieldbooks/${fieldbookId}/artifacts`,
      payload,
    );
    return res.data.artifact!.id;
  }
}
