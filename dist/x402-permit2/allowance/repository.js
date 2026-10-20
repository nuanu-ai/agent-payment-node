import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { PERMIT2_ALLOWANCE_STORE, validatePermit2Allowance } from "./model.js";
const WRITE_ONCE = ["signed", "submittedAt", "outcome"];
/** `permit2-allowance/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export class Permit2AllowanceRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory(PERMIT2_ALLOWANCE_STORE); })();
        await this.initialized;
    }
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    async find(operationId) {
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        const record = validatePermit2Allowance(value);
        if (record.operationId !== operationId)
            corrupt();
        return record;
    }
    async required(operationId) {
        const record = await this.find(operationId);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The Permit2 allowance operation was not found.");
        return record;
    }
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    async persistLocked(next) {
        validatePermit2Allowance(next);
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
        stateIdentifier(operationId, "Permit2 allowance operation ID");
        return `${PERMIT2_ALLOWANCE_STORE}/${operationId}.json`;
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The Permit2 allowance store or its continuity is invalid."); }
//# sourceMappingURL=repository.js.map