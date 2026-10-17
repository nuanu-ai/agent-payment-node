import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { gaslessCorrupt, validateGaslessContinuity, validateGaslessOperation } from "./operation-validation.js";
import { gaslessReceipt } from "./receipt.js";
import { gaslessAtTransition } from "./transitions.js";
import { gaslessFailure, gaslessSame } from "./validation.js";
export class GaslessOperationRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => {
            await super.initialize();
            await this.ensureDirectory("gasless-operations");
        })();
        await this.initialized;
    }
    async loadOperation(profileHash, operationId) {
        const value = await this.readJson(this.path("gasless-operations", profileHash, operationId));
        if (value === null)
            return null;
        const op = validateGaslessOperation(value);
        if (op.profileHash !== profileHash || op.operationId !== operationId)
            gaslessCorrupt();
        return op;
    }
    async findOperation(operationId) {
        stateIdentifier(operationId, "gasless operation ID");
        return await this.findInProfiles("gasless-operations", async (profileHash) => await this.loadOperation(profileHash, operationId), gaslessCorrupt);
    }
    async writeOperation(op) {
        validateGaslessOperation(op);
        await this.ready();
        if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > 1024 * 1024)
            gaslessFailure("APN_OPERATION_BLOCKED", "gasless_record_capacity");
        const previous = await this.loadOperation(op.profileHash, op.operationId);
        if (previous !== null)
            validateGaslessContinuity(previous, op);
        else if (op.state !== "awaiting_approval" || op.transitions.length !== 1)
            gaslessCorrupt();
        if (previous !== null && gaslessSame(previous, op))
            return;
        await this.ensureDirectory(`gasless-operations/${op.profileHash}`);
        await this.writeJson(this.path("gasless-operations", op.profileHash, op.operationId), op);
    }
    /** Caller holds the same profile/operation locks as all money families. Its receipt is derived on read. */
    async persist(op) {
        await this.writeOperation(op);
    }
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    async loadReceipt(profileHash, operationId) {
        const op = await this.loadOperation(profileHash, operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The gasless operation was not found.");
        const value = await this.readJson(this.path("gasless-receipts", profileHash, operationId));
        if (value !== null && receiptTransition(value, op) === op.transitions.length - 1)
            return value;
        return gaslessReceipt(op);
    }
    path(root, profileHash, operationId) {
        stateIdentifier(profileHash, "gasless profile hash");
        stateIdentifier(operationId, "gasless operation ID");
        return `${root}/${profileHash}/${operationId}.json`;
    }
}
// Proof classes that earlier releases wrote for a transition whose projection now names a different one.
const HISTORICAL_PROOF_CLASSES = ["effect_observation_pending"];
/** The transition an authentic stored receipt belongs to; corrupt otherwise. */
function receiptTransition(value, op) {
    if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint)
        gaslessCorrupt();
    const { receipt_hash, ...body } = value;
    if (hashObject(body) !== receipt_hash)
        gaslessCorrupt();
    const index = op.transitions.findIndex((_, i) => gaslessAtTransition(op, i).integrityHash === value.operation_binding_hash);
    // A stale authentic receipt has its historical shape, including the absence
    // of optional proof fields added by a later transition. Exact comparison to
    // that transition rejects extra fields without requiring the latest shape.
    if (index < 0)
        gaslessCorrupt();
    const rebuilt = gaslessReceipt(gaslessAtTransition(op, index));
    if (gaslessSame(value, rebuilt))
        return index;
    // An authentic receipt of the same transition may still carry the proof class its own release named.
    if (typeof value.proof_class !== "string" || !HISTORICAL_PROOF_CLASSES.includes(value.proof_class) ||
        !gaslessSame({ ...body, proof_class: rebuilt.proof_class, receipt_hash: rebuilt.receipt_hash }, rebuilt))
        gaslessCorrupt();
    return index;
}
//# sourceMappingURL=operation-repository.js.map