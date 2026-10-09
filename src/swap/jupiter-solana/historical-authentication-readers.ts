import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ChainAccountStore } from "../../chain-account-store.js";
import { ApnError } from "../../errors.js";
import { validateDirectory } from "../../secure-state-store.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";

export function historicalAuthenticationRefused(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Historical Jupiter material authentication is unavailable.");
}
/** Existing store readers may initialize. These private adapters refuse creation or mutation. */
export async function existingHistoricalRoot(root: string): Promise<void> {
  try { validateDirectory(await lstat(root), true); if (await realpath(root) !== root) historicalAuthenticationRefused(); }
  catch { historicalAuthenticationRefused(); }
}
async function existingDirectory(root: string, relative: string): Promise<void> {
  try {
    const path = join(root, relative), stat = await lstat(path);
    validateDirectory(stat, false);
    if (await realpath(path) !== path) historicalAuthenticationRefused();
  } catch { historicalAuthenticationRefused(); }
}
export class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
  protected override async ensureDirectory(path: string): Promise<void> { await existingDirectory(this.root, path); }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
}
export class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
  protected override async ensureDirectory(path: string): Promise<void> { await existingDirectory(this.root, path); }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
}
export class HistoricalCustodyReader extends ChainAccountStore {
  protected override async ensureDirectory(path: string): Promise<void> { await existingDirectory(this.root, path); }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
}
