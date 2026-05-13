import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { VeraConfigSchema, type VeraConfig } from "./schema/index.ts";
import { JsonEvidenceStore } from "./store/json-store.ts";
import { StacksClient, StacksSyncStore, IdMap } from "./stacks/index.ts";
import type { EvidenceStore } from "./store/types.ts";

const CONFIG_FILENAME = "vera.config.json";

export function resolveStorePath(cwd?: string): string {
  return join(cwd ?? process.cwd(), "evidence-store");
}

export function resolveConfigPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), CONFIG_FILENAME);
}

export function resolveArtifactsPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), "artifacts");
}

export function resolveInboxPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), "inbox");
}

export async function loadConfig(cwd?: string): Promise<VeraConfig> {
  const configPath = resolveConfigPath(cwd);
  try {
    const raw = await readFile(configPath, "utf-8");
    return VeraConfigSchema.parse(JSON.parse(raw));
  } catch {
    return VeraConfigSchema.parse({});
  }
}

export async function saveConfig(
  config: VeraConfig,
  cwd?: string,
): Promise<void> {
  const configPath = resolveConfigPath(cwd);
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

export function defaultConfig(): VeraConfig {
  return VeraConfigSchema.parse({});
}

/**
 * Returns an EvidenceStore, optionally wrapped with Stacks sync
 * if stacks config is present and sync_enabled is true.
 */
export async function getStore(cwd?: string): Promise<EvidenceStore> {
  const config = await loadConfig(cwd);
  const storePath = resolveStorePath(cwd);
  const inner = new JsonEvidenceStore(storePath);

  if (config.stacks?.sync_enabled) {
    const client = new StacksClient(config.stacks.url);
    const idMap = new IdMap(storePath);
    return new StacksSyncStore(inner, client, idMap, config.stacks.fieldbook_id);
  }

  return inner;
}
