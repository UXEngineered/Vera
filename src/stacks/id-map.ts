/**
 * Bidirectional ID mapping between Vera IDs and Stacks IDs.
 * Persisted as a JSON file in the evidence store directory.
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const FILENAME = "stacks-id-map.json";

export class IdMap {
  private filePath: string;
  private cache: Record<string, string> | null = null;

  constructor(storePath: string) {
    this.filePath = join(storePath, FILENAME);
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.cache = JSON.parse(raw);
      return this.cache!;
    } catch {
      this.cache = {};
      return this.cache;
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2));
  }

  async set(veraId: string, stacksId: string): Promise<void> {
    const map = await this.load();
    map[veraId] = stacksId;
    await this.save();
  }

  async get(veraId: string): Promise<string | undefined> {
    const map = await this.load();
    return map[veraId];
  }

  async resolveMany(veraIds: string[]): Promise<string[]> {
    const map = await this.load();
    return veraIds
      .map((id) => map[id])
      .filter((id): id is string => id !== undefined);
  }

  async allValues(): Promise<string[]> {
    const map = await this.load();
    return Object.values(map);
  }
}
