import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { X402_SOLANA_STORE } from "./constants.js";
import { validateX402SolanaRecord } from "./model.js";
const WRITE_ONCE = ["lifetime", "lease", "signed", "exposure", "response", "settlement", "unlanded"];
/** `x402-solana/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export class X402SolanaRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory(X402_SOLANA_STORE); })();
        await this.initialized;
    }
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    async find(operationId) {
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        const record = validateX402SolanaRecord(value);
        if (record.operationId !== operationId)
            corrupt();
        return record;
    }
    async required(operationId) {
        const record = await this.find(operationId);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The Solana x402 operation was not found.");
        return record;
    }
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    async persistLocked(next) {
        validateX402SolanaRecord(next);
        await this.ready();
        const previous = await this.find(next.operationId);
        if (previous === null) {
            if (next.journal.length !== 1 || next.state !== "prepared")
                corrupt();
            await this.writeJson(this.path(next.operationId), next, true);
            return next;
        }
        if (previous.terminal || previous.fingerprint !== next.fingerprint || next.journal.length < previous.journal.length ||
            canonicalJson(next.journal.slice(0, previous.journal.length)) !== canonicalJson(previous.journal) ||
            WRITE_ONCE.some((key) => previous[key] !== null && canonicalJson(previous[key]) !== canonicalJson(next[key])))
            corrupt();
        await this.writeJson(this.path(next.operationId), next);
        return next;
    }
    path(operationId) {
        stateIdentifier(operationId, "Solana x402 operation ID");
        return `${X402_SOLANA_STORE}/${operationId}.json`;
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The Solana x402 store or its continuity is invalid."); }
//# sourceMappingURL=repository.js.map