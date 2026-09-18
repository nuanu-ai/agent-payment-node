import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { parseAtomic } from "../money.js";
import { validateSwapQuote } from "./quote.js";
export const SWAP_OPERATION_SCHEMA = "apn.swap-operation.v1";
const HASH = /^[a-f0-9]{64}$/u, VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
export function newSwapOperation(input) {
    const at = date(input.now, "input"), quote = validateSwapQuote(input.quote, "input");
    if (at < quote.effectiveAt || at >= quote.expiresAt)
        invalid("Swap quote is not effective at operation creation.");
    const body = { schemaVersion: SWAP_OPERATION_SCHEMA, operationId: hash(input.operationId, "input"),
        idempotencyHash: hash(input.idempotencyHash, "input"), ownerProfileHash: quote.profileHash, state: "quoted",
        revision: 1, createdAt: at, updatedAt: at, quote, policyDigest: hash(input.policyDigest, "input"),
        policyVersion: version(input.policyVersion, "input"), protocolRegistryDigest: hash(input.protocolRegistryDigest, "input"),
        protocolRegistryVersion: version(input.protocolRegistryVersion, "input"), mechanismDigest: hash(input.mechanismDigest, "input"),
        usageLease: null, approvalCapAtomic: approval(input.approvalCapAtomic, quote.inputAmountAtomic, "input"),
        submissionMarker: null, receiptProof: null, failureProofHash: null, previousIntegrityHash: null };
    return validateSwapOperation({ ...body, integrityHash: digest(body) });
}
export function validateSwapOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "idempotencyHash", "ownerProfileHash", "state",
        "revision", "createdAt", "updatedAt", "quote", "policyDigest", "policyVersion", "protocolRegistryDigest",
        "protocolRegistryVersion", "mechanismDigest", "usageLease",
        "approvalCapAtomic", "submissionMarker", "receiptProof", "failureProofHash", "previousIntegrityHash", "integrityHash"]) ||
        value.schemaVersion !== SWAP_OPERATION_SCHEMA || !STATES.includes(value.state) ||
        typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1)
        corrupt("Swap operation schema is invalid.");
    const quote = validateSwapQuote(value.quote);
    hash(value.operationId, "stored");
    hash(value.idempotencyHash, "stored");
    hash(value.ownerProfileHash, "stored");
    hash(value.policyDigest, "stored");
    hash(value.protocolRegistryDigest, "stored");
    hash(value.mechanismDigest, "stored");
    version(value.policyVersion, "stored");
    version(value.protocolRegistryVersion, "stored");
    const createdAt = date(value.createdAt, "stored"), updatedAt = date(value.updatedAt, "stored");
    if (updatedAt < createdAt || value.ownerProfileHash !== quote.profileHash)
        corrupt("Swap operation owner binding is invalid.");
    approval(value.approvalCapAtomic, quote.inputAmountAtomic, "stored");
    const lease = value.usageLease === null ? null : validateAssetUsageReservation(value.usageLease);
    if (lease !== null && (lease.account !== quote.account || lease.chain !== quote.sourceAsset.chain || lease.rail !== "swap" ||
        canonicalJson(lease.asset) !== canonicalJson(quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
            { kind: "token", identifier: quote.sourceAsset.identifier }) || lease.amountAtomic !== quote.inputAmountAtomic ||
        lease.policyDigest !== value.policyDigest))
        corrupt("Swap usage lease binding is invalid.");
    validateStateBindings(value);
    const { integrityHash, ...body } = value;
    if (typeof integrityHash !== "string" || integrityHash !== digest(body))
        corrupt("Swap operation integrity validation failed.");
    return value;
}
const STATES = ["quoted", "prepared", "awaiting_approval", "reserved", "submitting", "submitted",
    "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];
function validateStateBindings(op) {
    if (op.previousIntegrityHash !== null)
        hash(op.previousIntegrityHash, "stored");
    const reserved = ["reserved", "submitting", "submitted", "unknown_finality", "finalized", "failed_confirmed_revert"].includes(op.state);
    if (reserved && op.usageLease === null)
        corrupt("Swap operation usage lease phase is invalid.");
    if (["quoted", "prepared", "awaiting_approval"].includes(op.state) && op.usageLease !== null)
        corrupt("Swap operation usage lease phase is invalid.");
    const exposed = ["submitting", "submitted", "unknown_finality", "finalized", "failed_confirmed_revert"].includes(op.state);
    if (exposed !== (op.submissionMarker !== null))
        corrupt("Swap submission marker phase is invalid.");
    if (op.submissionMarker !== null) {
        if (!isPlainRecord(op.submissionMarker) || !exactKeys(op.submissionMarker, ["markerHash", "markedAt", "operationIntegrityHash", "unsignedTransactionPayloadHash"]) ||
            hash(op.submissionMarker.markerHash, "stored") !== op.submissionMarker.markerHash || date(op.submissionMarker.markedAt, "stored") === "" ||
            hash(op.submissionMarker.operationIntegrityHash, "stored") !== op.submissionMarker.operationIntegrityHash ||
            op.submissionMarker.markedAt < op.createdAt || op.submissionMarker.markedAt > op.updatedAt ||
            op.submissionMarker.unsignedTransactionPayloadHash !== op.quote.unsignedTransactionPayloadHash)
            corrupt("Swap submission marker is invalid.");
        const markerBody = { operationId: op.operationId, operationIntegrityHash: op.submissionMarker.operationIntegrityHash,
            unsignedTransactionPayloadHash: op.submissionMarker.unsignedTransactionPayloadHash, markedAt: op.submissionMarker.markedAt };
        if (op.submissionMarker.markerHash !== domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody))) {
            corrupt("Swap submission marker integrity validation failed.");
        }
    }
    const expectedLeaseState = op.state === "reserved" || op.state === "submitting" ? "reserved" : op.state;
    if (op.usageLease !== null && reserved && op.usageLease.state !== expectedLeaseState) {
        corrupt("Swap usage lease state is inconsistent with the operation phase.");
    }
    if (op.receiptProof !== null) {
        if (op.submissionMarker === null)
            corrupt("Swap receipt proof phase is invalid.");
        validateSwapReceiptProof(op.receiptProof, op.quote.sourceAsset.chain, op.submissionMarker.markedAt, op.updatedAt, "stored");
    }
    if (op.receiptProof !== null && !["submitted", "unknown_finality", "finalized", "failed_confirmed_revert"].includes(op.state))
        corrupt("Swap receipt proof phase is invalid.");
    if (op.state === "finalized" && (op.receiptProof === null || !op.receiptProof.finalized))
        corrupt("Finalized swap lacks final receipt proof.");
    if (op.failureProofHash !== null)
        hash(op.failureProofHash, "stored");
    const failed = op.state === "failed_before_effect" || op.state === "failed_confirmed_revert";
    if (failed !== (op.failureProofHash !== null))
        corrupt("Swap failure proof phase is invalid.");
    if (op.state === "failed_confirmed_revert" && (op.receiptProof === null || !op.receiptProof.finalized ||
        op.receiptProof.receiptHash !== op.failureProofHash))
        corrupt("Confirmed swap revert lacks its finalized revert proof.");
    if (op.state === "failed_before_effect" && (op.submissionMarker !== null ||
        (op.usageLease !== null && op.usageLease.state !== "failed_before_effect")))
        corrupt("Pre-effect failure lease is not released.");
}
export function validateSwapReceiptProof(value, chain, earliestAt, latestAt, mode = "input") {
    const fail = (message) => failure(mode, message);
    if (!isPlainRecord(value) || !exactKeys(value, ["receiptHash", "transactionHash", "observedAt", "finalized"]) ||
        typeof value.finalized !== "boolean" || typeof value.transactionHash !== "string" || value.transactionHash.length < 8 ||
        value.transactionHash.length > 256)
        fail("Swap receipt proof is invalid.");
    const record = value;
    hash(record.receiptHash, mode);
    const observedAt = date(record.observedAt, mode);
    if (observedAt < earliestAt || observedAt > latestAt)
        fail("Swap receipt proof time binding is invalid.");
    const transactionHash = record.transactionHash;
    if (/^eip155:/u.test(chain) && !/^0x[a-fA-F0-9]{64}$/u.test(transactionHash))
        fail("Swap EVM transaction hash is invalid.");
    if (/^tron:/u.test(chain) && !/^[a-fA-F0-9]{64}$/u.test(transactionHash))
        fail("Swap TRON transaction hash is invalid.");
    if (/^solana:/u.test(chain) && !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(transactionHash))
        fail("Swap Solana transaction signature is invalid.");
    return value;
}
function approval(value, input, mode) {
    try {
        if (typeof value !== "string")
            throw new Error();
        const amount = parseAtomic(value);
        const maximum = BigInt(input);
        if (amount > maximum || amount === MAX_UINT256)
            throw new Error();
        return amount.toString();
    }
    catch {
        return failure(mode, "Swap approval cap must be canonical, bounded by exact input, and never unlimited.");
    }
}
function digest(value) { return domainHash(SWAP_OPERATION_SCHEMA, canonicalJson(value)); }
function hash(value, mode) { if (typeof value !== "string" || !HASH.test(value))
    failure(mode, "Swap hash binding is invalid."); return value; }
function version(value, mode) { if (typeof value !== "string" || !VERSION.test(value))
    failure(mode, "Swap version binding is invalid."); return value; }
function date(value, mode) {
    if (typeof value !== "string" && !(value instanceof Date))
        failure(mode, "Swap operation instant is invalid.");
    const raw = value instanceof Date ? value.toISOString() : value;
    if (!Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw)
        failure(mode, "Swap operation instant is invalid.");
    return raw;
}
function failure(mode, message) { throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message); }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=model.js.map