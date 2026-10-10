import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
const SCHEMA = "apn.jupiter-v1-dispatch-observation.v1";
const CODES = ["APN_RPC_PROTOCOL", "APN_RPC_AMBIGUOUS", "APN_RPC_RATE_LIMITED", "APN_RPC_BUDGET_EXCEEDED",
    "APN_RPC_CONFIG", "APN_PROVIDER_UNAVAILABLE", "APN_OPERATION_BLOCKED", "APN_STATE_CORRUPT", "APN_INTERNAL"];
const REASONS = ["blockhash_not_found", "insufficient_funds_for_fee", "account_not_found", "already_processed", "instruction_error", "unclassified"];
export function jupiterV1DispatchResult(outcome, error) {
    const apn = error instanceof ApnError ? error : null;
    const errorCode = outcome !== "error" ? null : CODES.includes(apn?.code) ? apn.code : "APN_INTERNAL";
    const details = apn?.details;
    return { outcome, errorCode, rpcErrorCode: integer(details?.rpcErrorCode, -2147483648, 2147483647),
        rpcErrorReason: REASONS.includes(details?.rpcErrorReason) ? details.rpcErrorReason : null,
        httpStatus: integer(details?.httpStatus, 100, 599), retryAfterMs: integer(details?.retryAfterMs, 0, 86400000) };
}
/** An immutable public diagnostic. It never authorizes retry, settles usage, or proves chain finality. */
export class JupiterV1DispatchStore extends SecureStateStore {
    initialized;
    bindings;
    constructor(root) { super(root); this.bindings = new JupiterV1ExecutionBindingStore(root); }
    async save(op, bindingHash, result, now) {
        await this.ready();
        const claim = await this.bindings.loadClaim(op);
        if (claim === null || claim.bindingHash !== bindingHash)
            corrupt();
        const body = { schemaVersion: SCHEMA, operationId: op.operationId, markerHash: claim.markerHash, claimHash: claim.claimHash,
            bindingHash, signature: claim.signature, observedAt: now.toISOString(), ...result };
        const record = { ...body, recordHash: domainHash(SCHEMA, canonicalJson(body)) };
        await this.validate(record, op);
        const path = this.path(op), prior = await this.readJson(path);
        if (prior !== null) {
            if (canonicalJson(await this.validate(prior, op)) !== canonicalJson(record))
                corrupt();
            return;
        }
        await this.ensureDirectory(`jupiter-v1-dispatch/${op.ownerProfileHash}`);
        await this.writeJson(path, record, true);
    }
    async load(op) {
        if (op.submissionMarker === null)
            return null;
        await this.ready();
        const value = await this.readJson(this.path(op));
        return value === null ? null : await this.validate(value, op);
    }
    async validate(value, op) {
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "markerHash", "claimHash", "bindingHash", "signature",
            "observedAt", "outcome", "errorCode", "rpcErrorCode", "rpcErrorReason", "httpStatus", "retryAfterMs", "recordHash"]))
            corrupt();
        const r = value, { recordHash, ...body } = r;
        const claim = await this.bindings.loadClaim(op);
        if (claim === null || r.schemaVersion !== SCHEMA || r.operationId !== op.operationId || r.markerHash !== op.submissionMarker?.markerHash ||
            r.claimHash !== claim.claimHash || r.bindingHash !== claim.bindingHash || r.signature !== claim.signature ||
            recordHash !== domainHash(SCHEMA, canonicalJson(body)) || !["acknowledged", "signature_mismatch", "error"].includes(r.outcome) ||
            !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt || r.observedAt < claim.claimedAt ||
            (r.outcome === "error" ? !CODES.includes(r.errorCode) : r.errorCode !== null) ||
            (r.rpcErrorCode !== null && integer(r.rpcErrorCode, -2147483648, 2147483647) === null) ||
            (r.rpcErrorReason !== null && !REASONS.includes(r.rpcErrorReason)) ||
            (r.httpStatus !== null && integer(r.httpStatus, 100, 599) === null) ||
            (r.retryAfterMs !== null && integer(r.retryAfterMs, 0, 86400000) === null) ||
            (r.outcome !== "error" && [r.rpcErrorCode, r.rpcErrorReason, r.httpStatus, r.retryAfterMs].some(v => v !== null)))
            corrupt();
        return JSON.parse(canonicalJson(r));
    }
    path(op) {
        stateIdentifier(op.ownerProfileHash, "Jupiter profile");
        stateIdentifier(op.operationId, "Jupiter operation");
        return `jupiter-v1-dispatch/${op.ownerProfileHash}/${op.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("jupiter-v1-dispatch"); })();
        await this.initialized;
    }
}
function integer(value, minimum, maximum) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Jupiter dispatch observation has invalid claim binding or public fields."); }
//# sourceMappingURL=v1-dispatch.js.map