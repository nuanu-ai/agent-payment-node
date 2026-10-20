import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateWalletAllowanceRevoke, WALLET_ALLOWANCE_REVOKE_STORE, walletAllowanceSlot } from "./model.js";
const WRITE_ONCE = ["signed", "submittedAt", "outcome"];
const RECORD = /^[a-f0-9]{64}\.json$/u;
/** `wallet-allowance-revokes/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export class WalletAllowanceRevokeRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory(WALLET_ALLOWANCE_REVOKE_STORE); })();
        await this.initialized;
    }
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    async find(operationId) {
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        const record = validateWalletAllowanceRevoke(value);
        if (record.operationId !== operationId)
            corrupt();
        return record;
    }
    async required(operationId) {
        const record = await this.find(operationId);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The allowance revoke operation was not found.");
        return record;
    }
    /** The open (non-terminal) revoke of one slot, if any; the account claim keeps it to at most one. */
    async open(slot) {
        await this.ready();
        for (const entry of await this.readDirectory(WALLET_ALLOWANCE_REVOKE_STORE)) {
            if (!entry.isFile() || !RECORD.test(entry.name))
                continue;
            const record = await this.find(entry.name.slice(0, 64));
            if (record !== null && !record.terminal && walletAllowanceSlot(record) === slot)
                return record;
        }
        return null;
    }
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    async persistLocked(next) {
        validateWalletAllowanceRevoke(next);
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
        stateIdentifier(operationId, "Allowance revoke operation ID");
        return `${WALLET_ALLOWANCE_REVOKE_STORE}/${operationId}.json`;
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The allowance revoke store or its continuity is invalid."); }
//# sourceMappingURL=repository.js.map