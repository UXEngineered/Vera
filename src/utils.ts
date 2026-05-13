import { readdir, readFile } from "fs/promises";
import { join } from "path";

export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Generate the next sequential ID for an entity type.
 * Reads existing files in the directory to find the highest current number.
 */
export async function nextId(
  dir: string,
  prefix: string,
): Promise<string> {
  try {
    const files = await readdir(dir);
    const numbers = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const match = f.replace(".json", "").match(/(\d+)$/);
        return match ? parseInt(match[1]!, 10) : 0;
      })
      .filter((n) => !isNaN(n));

    const max = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `${prefix}-${String(max + 1).padStart(3, "0")}`;
  } catch {
    return `${prefix}-001`;
  }
}

export function computeRiskPriority(
  impact: string,
  uncertainty: string,
  testCost: string,
): number {
  const impactScore: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const uncertaintyScore: Record<string, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const testCostScore: Record<string, number> = {
    low: 3,
    medium: 2,
    high: 1,
  };

  return (
    (impactScore[impact] ?? 1) * 2 +
    (uncertaintyScore[uncertainty] ?? 1) * 1.5 +
    (testCostScore[testCost] ?? 1)
  );
}

export function daysSince(dateStr: string): number {
  const then = new Date(dateStr);
  const diff = Date.now() - then.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function parseTimebox(timebox: string): number {
  const match = timebox.match(/(\d+)\s*(day|week|month)/i);
  if (!match) return 7;
  const num = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  if (unit.startsWith("week")) return num * 7;
  if (unit.startsWith("month")) return num * 30;
  return num;
}

/**
 * Load and parse a JSON file, returning null if it doesn't exist.
 */
export async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
