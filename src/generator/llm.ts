import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Add it to .env or set the environment variable.",
    );
  }

  client = new Anthropic({ apiKey });
  return client;
}

export async function generate(
  systemPrompt: string,
  userPrompt: string,
  model: string = "claude-opus-4-5-20250918",
): Promise<string> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("LLM returned empty response");
  }

  return block.text;
}

export async function generateJson<T>(
  systemPrompt: string,
  userPrompt: string,
  model: string = "claude-opus-4-5-20250918",
): Promise<T> {
  const content = await generate(systemPrompt, userPrompt, model);

  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : content.trim();

  return JSON.parse(jsonStr) as T;
}
