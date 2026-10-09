import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ChainAccountStore } from "../../chain-account-store.js";
import { ApnError } from "../../errors.js";
import { validateDirectory } from "../../secure-state-store.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";
export function historicalAuthenticationRefused() {
    throw new ApnError("APN_OPERATION_BLOCKED", "Historical Jupiter material authentication is unavailable.");
}
/** Existing store readers may initialize. These private adapters refuse creation or mutation. */
export async function existingHistoricalRoot(root) {
    try {
        validateDirectory(await lstat(root), true);
        if (await realpath(root) !== root)
            historicalAuthenticationRefused();
    }
    catch {
        historicalAuthenticationRefused();
    }
}
async function existingDirectory(root, relative) {
    try {
        const path = join(root, relative), stat = await lstat(path);
        validateDirectory(stat, false);
        if (await realpath(path) !== path)
            historicalAuthenticationRefused();
    }
    catch {
        historicalAuthenticationRefused();
    }
}
export class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
    async ensureDirectory(path) { await existingDirectory(this.root, path); }
    async writeJson() { historicalAuthenticationRefused(); }
}
export class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
    async ensureDirectory(path) { await existingDirectory(this.root, path); }
    async writeJson() { historicalAuthenticationRefused(); }
}
export class HistoricalCustodyReader extends ChainAccountStore {
    async ensureDirectory(path) { await existingDirectory(this.root, path); }
    async writeJson() { historicalAuthenticationRefused(); }
}
//# sourceMappingURL=historical-authentication-readers.js.map