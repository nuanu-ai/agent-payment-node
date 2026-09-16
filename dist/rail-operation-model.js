import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { validateChainAccount } from "./chain-account-store.js";
import { atomic, isoDate, SOLANA_GENESIS, validateChainAsset } from "./chain-policy.js";
import { ApnError } from "./errors.js";
import { validateRailSendBinding } from "./rail-send-binding.js";
import { TRON_GENESIS } from "./tron/constants.js";
import { validateTronFinalResources, validateTronResources } from "./tron/resource-model.js";
const TERMINAL = ["completed", "failed_before_effect", "failed_confirmed_revert", "abandoned_unknown"];
const EDGES = {
    awaiting_approval: ["signing_started", "submitting", "failed_before_effect"],
    signing_started: ["signed_not_submitted", "failed_before_effect"],
    signed_not_submitted: ["submitting", "failed_before_effect"],
    submitting: ["submitted_pending", "unknown_finality", "completed", "failed_confirmed_revert"],
    submitted_pending: ["unknown_finality", "completed", "failed_confirmed_revert", "abandoned_unknown"],
    unknown_finality: ["completed", "failed_confirmed_revert", "abandoned_unknown"],
    completed: [], failed_before_effect: [], failed_confirmed_revert: [], abandoned_unknown: [],
};
const HASH = /^[a-f0-9]{64}$/u;
const RECORD_KEYS = ["schemaVersion", "kind", "operationId", "profile", "profileHash", "idempotencyHash", "requestHash",
    "account", "prepared", "policyHash", "fingerprint", "state", "terminal", "reason", "proofClass", "transactionId",
    "rawPayloadHash", "evidence", "createdAt", "updatedAt", "transitions", "integrityHash"];
export function newRailOperation(intent) {
    const fingerprint = hashObject(intent);
    const entry = {
        state: "awaiting_approval", at: intent.prepared.preparedAt,
        reason: "prepared_and_frozen", proofClass: "durable_pre_effect",
        transactionId: null, rawPayloadHash: null, evidence: null, previousHash: fingerprint,
    };
    return seal({ ...intent, fingerprint, ...latest(entry), terminal: false,
        createdAt: entry.at, transitions: [{ ...entry, transitionHash: hashObject(entry) }],
    });
}
export function transitionRail(operation, input) {
    validateRailOperation(operation);
    const entry = {
        state: input.state, at: input.at, reason: input.reason, proofClass: input.proofClass,
        transactionId: input.transactionId ?? operation.transactionId,
        rawPayloadHash: input.rawPayloadHash ?? operation.rawPayloadHash,
        evidence: input.evidence ?? operation.evidence,
        previousHash: operation.transitions[operation.transitions.length - 1].transitionHash,
    };
    const { integrityHash: _hash, ...body } = operation;
    const result = seal({ ...body, ...(input.send === undefined ? {} : { send: input.send }),
        ...latest(entry), terminal: TERMINAL.includes(entry.state),
        transitions: [...operation.transitions, { ...entry, transitionHash: hashObject(entry) }],
    });
    validateRailContinuity(operation, result);
    return result;
}
export function validateRailContinuity(previous, next) {
    validateRailOperation(previous);
    validateRailOperation(next);
    if (canonicalJson(previous) === canonicalJson(next))
        return;
    if (previous.terminal || previous.fingerprint !== next.fingerprint || next.transitions.length !== previous.transitions.length + 1 ||
        canonicalJson(next.transitions.slice(0, -1)) !== canonicalJson(previous.transitions))
        corrupt();
    // A send binding is taken once: it may appear, and afterwards it can never be restated.
    // The send binding is written once. Canonical JSON cannot represent `undefined`, so presence is compared first:
    // a record written before the field existed carries it in no transition, and a mixed record is corrupt.
    if (previous.send !== undefined && (next.send === undefined || canonicalJson(previous.send) !== canonicalJson(next.send)))
        corrupt();
}
export function validateRailOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, Object.hasOwn(value, "send") ? [...RECORD_KEYS, "send"] : RECORD_KEYS))
        corrupt();
    if (value.schemaVersion !== "apn.rail-operation.v1" || value.kind !== "rail_transfer")
        corrupt();
    for (const key of ["operationId", "profileHash", "idempotencyHash", "requestHash", "policyHash", "fingerprint", "integrityHash"])
        if (typeof value[key] !== "string" || !HASH.test(value[key]))
            corrupt();
    const account = validateChainAccount(value.account);
    const prepared = validateRailPrepared(value.prepared, account);
    if (value.profile !== account.profile || value.profileHash !== account.profileHash)
        corrupt();
    if (value.send !== undefined) {
        if (account.provider !== "local" || !Array.isArray(value.transitions) ||
            !value.transitions.some((entry) => isPlainRecord(entry) && entry.state === "signing_started"))
            corrupt();
        validateRailSendBinding(value.send, prepared);
    }
    const operation = value;
    if (hashObject(intentOf(operation)) !== value.fingerprint)
        corrupt();
    isoDate(value.createdAt);
    isoDate(value.updatedAt);
    if (value.createdAt !== prepared.preparedAt || !Array.isArray(value.transitions) || value.transitions.length < 1 || value.transitions.length > 32)
        corrupt();
    let previous;
    for (const raw of value.transitions) {
        if (!isPlainRecord(raw) || !exactKeys(raw, ["state", "at", "reason", "proofClass", "transactionId", "rawPayloadHash", "evidence", "previousHash", "transitionHash"]))
            corrupt();
        if (typeof raw.state !== "string" || !Object.hasOwn(EDGES, raw.state))
            corrupt();
        for (const key of ["reason", "proofClass"])
            if (typeof raw[key] !== "string" || !/^[a-z][a-z0-9_]{0,95}$/u.test(raw[key]))
                corrupt();
        isoDate(raw.at);
        const entry = raw;
        const { transitionHash, ...body } = entry;
        if (hashObject(body) !== transitionHash || entry.previousHash !== (previous?.transitionHash ?? value.fingerprint))
            corrupt();
        if (previous === undefined) {
            if (entry.state !== "awaiting_approval" || entry.at !== value.createdAt || entry.transactionId !== null || entry.rawPayloadHash !== null || entry.evidence !== null)
                corrupt();
        }
        else {
            if (!EDGES[previous.state].includes(entry.state) || entry.at < previous.at)
                corrupt();
            if (previous.transactionId !== null && entry.transactionId !== previous.transactionId)
                corrupt();
            if (previous.rawPayloadHash !== null && entry.rawPayloadHash !== previous.rawPayloadHash)
                corrupt();
        }
        if (entry.transactionId !== null)
            validateRailTransactionId(entry.transactionId, account.rail);
        if (entry.rawPayloadHash !== null && (typeof entry.rawPayloadHash !== "string" || !HASH.test(entry.rawPayloadHash)))
            corrupt();
        if (account.provider === "local") {
            if (["signed_not_submitted", "submitting", "submitted_pending", "unknown_finality", "completed", "failed_confirmed_revert", "abandoned_unknown"].includes(entry.state) && (entry.transactionId === null || entry.rawPayloadHash === null))
                corrupt();
            if (previous?.state === "awaiting_approval" && entry.state === "submitting")
                corrupt();
        }
        else if (["signing_started", "signed_not_submitted"].includes(entry.state) || entry.rawPayloadHash !== null)
            corrupt();
        if (["completed", "failed_confirmed_revert"].includes(entry.state)) {
            if (entry.evidence === null || entry.transactionId === null)
                corrupt();
            validateRailEvidence(entry.evidence, prepared, entry.transactionId, entry.state === "completed");
            if (entry.evidence.observedAt > entry.at)
                corrupt();
        }
        else if (entry.evidence !== null)
            corrupt();
        previous = entry;
    }
    if (previous === undefined || canonicalJson(latest(previous)) !== canonicalJson({ state: value.state, reason: value.reason, proofClass: value.proofClass, transactionId: value.transactionId, rawPayloadHash: value.rawPayloadHash, evidence: value.evidence, updatedAt: value.updatedAt }))
        corrupt();
    if (value.terminal !== TERMINAL.includes(previous.state))
        corrupt();
    const { integrityHash, ...body } = value;
    if (hashObject(body) !== integrityHash)
        corrupt();
    return operation;
}
export function validateRailPrepared(value, account) {
    if (!isPlainRecord(value) || !exactKeys(value, ["rail", "networkIdentity", "asset", "sender", "recipient", "amountAtomic", "maximumFeeAtomic", "economics", "preparedAt", "expiresAt", "blockReference", "lastValidBlockHeight", "unsignedPayload", "sourceTokenAccount", "destinationTokenAccount", "createsRecipientAccount", ...(account.rail === "tron" ? ["resources"] : [])]))
        corrupt();
    const asset = validateChainAsset(value.asset);
    if (asset.rail !== account.rail || value.rail !== account.rail || value.sender !== account.address || value.recipient === value.sender)
        corrupt();
    addressShape(value.recipient, account.rail);
    if (value.networkIdentity !== (account.rail === "solana" ? SOLANA_GENESIS : TRON_GENESIS))
        corrupt();
    if (typeof value.networkIdentity !== "string" || typeof value.blockReference !== "string" || !/^[A-Za-z0-9]{32,128}$/u.test(value.blockReference))
        corrupt();
    atomic(value.amountAtomic, true);
    atomic(value.maximumFeeAtomic, true);
    isoDate(value.preparedAt);
    isoDate(value.expiresAt);
    if (value.expiresAt <= value.preparedAt || Date.parse(value.expiresAt) - Date.parse(value.preparedAt) > 300_000)
        corrupt();
    if (value.lastValidBlockHeight !== null)
        atomic(value.lastValidBlockHeight);
    if (account.provider === "local") {
        if (typeof value.unsignedPayload !== "string" || value.unsignedPayload.length < 1 || value.unsignedPayload.length > 16_384)
            corrupt();
    }
    else if (value.unsignedPayload !== null)
        corrupt();
    for (const key of ["sourceTokenAccount", "destinationTokenAccount"])
        if (value[key] !== null)
            addressShape(value[key], account.rail);
    if (typeof value.createsRecipientAccount !== "boolean")
        corrupt();
    if (asset.rail === "solana" && asset.kind === "token" && (value.sourceTokenAccount === null || value.destinationTokenAccount === null))
        corrupt();
    if (asset.kind === "native" && (value.sourceTokenAccount !== null || value.destinationTokenAccount !== null || asset.rail === "solana" && value.createsRecipientAccount))
        corrupt();
    const cost = value.economics;
    if (!isPlainRecord(cost) || !exactKeys(cost, ["networkFeeMaximumAtomic", "recipientRentAtomic", "maximumNativeDebitAtomic", "networkFeePayer", "rentPayer", "feeControl"]))
        corrupt();
    const fee = atomic(cost.networkFeeMaximumAtomic);
    const rent = atomic(cost.recipientRentAtomic);
    const debit = atomic(cost.maximumNativeDebitAtomic);
    addressShape(cost.networkFeePayer, account.rail);
    if (cost.rentPayer !== null)
        addressShape(cost.rentPayer, account.rail);
    if (rent > 0n && cost.rentPayer === null)
        corrupt();
    if (debit !== (cost.networkFeePayer === account.address ? fee : 0n) + (cost.rentPayer === account.address ? rent : 0n) || debit > atomic(value.maximumFeeAtomic))
        corrupt();
    if (account.provider === "local" ? cost.feeControl !== (account.rail === "solana" ? "signed_message" : "tron_governance_window") || cost.networkFeePayer !== account.address : cost.feeControl !== "provider_guarantee")
        corrupt();
    if (account.rail === "tron") {
        if (account.provider !== "local" || rent !== 0n || cost.rentPayer !== null || value.lastValidBlockHeight !== null || value.sourceTokenAccount !== null || value.destinationTokenAccount !== null)
            corrupt();
        validateTronResources(value.resources, value);
    }
    return value;
}
export function validateRailEvidence(value, prepared, transactionId, success) {
    if (!isPlainRecord(value) || !exactKeys(value, ["networkIdentity", "transactionId", "blockNumberAtomic", "blockId", "finality", "sender", "recipient", "assetIdentifier", "amountAtomic", "actualNetworkFeeAtomic", "actualRecipientRentAtomic", "networkFeePayer", "senderEffectVerified", "recipientEffectVerified", "transactionVerified", "observedAt", "rpcOriginHash", ...(prepared.rail === "tron" ? ["resources"] : [])]))
        corrupt();
    if (value.networkIdentity !== prepared.networkIdentity || value.transactionId !== transactionId || value.sender !== prepared.sender || value.recipient !== prepared.recipient || value.assetIdentifier !== prepared.asset.identifier || value.amountAtomic !== prepared.amountAtomic || value.networkFeePayer !== prepared.economics.networkFeePayer || value.finality !== (prepared.rail === "solana" ? "finalized" : "solidified") || value.transactionVerified !== true)
        corrupt();
    if (value.senderEffectVerified !== success || value.recipientEffectVerified !== success)
        corrupt();
    atomic(value.blockNumberAtomic);
    if (atomic(value.actualNetworkFeeAtomic) > atomic(prepared.economics.networkFeeMaximumAtomic) || atomic(value.actualRecipientRentAtomic) > atomic(prepared.economics.recipientRentAtomic))
        corrupt();
    if (!success && value.actualRecipientRentAtomic !== "0")
        corrupt();
    if (typeof value.blockId !== "string" || !/^[A-Za-z0-9]{32,128}$/u.test(value.blockId) || typeof value.rpcOriginHash !== "string" || !HASH.test(value.rpcOriginHash))
        corrupt();
    isoDate(value.observedAt);
    if (prepared.rail === "tron") {
        const resources = validateTronFinalResources(value.resources, prepared, atomic(value.blockNumberAtomic), success);
        if (resources.totalFeeAtomic !== value.actualNetworkFeeAtomic || value.actualRecipientRentAtomic !== "0")
            corrupt();
    }
}
export function validateRailTransactionId(value, rail) {
    if (typeof value !== "string" || !(rail === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u : /^[a-f0-9]{64}$/u).test(value))
        corrupt();
}
export function publicRailOperation(operation) {
    validateRailOperation(operation);
    const { unsignedPayload: _unsigned, ...transfer } = operation.prepared;
    return {
        kind: operation.kind, schema_version: operation.schemaVersion, operation_id: operation.operationId,
        profile: operation.profile, provider: operation.account.provider, custody: operation.account.custody,
        account: operation.account.address, fingerprint: operation.fingerprint, policy_hash: operation.policyHash,
        transfer, ...(operation.send === undefined ? {} : { send_binding: operation.send }),
        state: operation.state, terminal: operation.terminal, proof_class: operation.proofClass,
        reason: operation.reason, transaction_id: operation.transactionId, evidence: operation.evidence,
        created_at: operation.createdAt, updated_at: operation.updatedAt, next_actions: railNextActions(operation),
    };
}
export function railNextActions(operation) {
    if (operation.terminal)
        return [];
    if (operation.state === "awaiting_approval")
        return [`apn pay transfer approve --operation ${operation.operationId}`];
    if (operation.state === "unknown_finality" && operation.transactionId === null)
        return ["Manual provider reconciliation is required; do not repeat the send."];
    return [`apn operation resume --operation ${operation.operationId}`];
}
export function railReceipt(operation) {
    const body = { ...publicRailOperation(operation), schema_version: "apn.rail-receipt.v1", operation_binding_hash: operation.integrityHash };
    return { ...body, receipt_hash: hashObject(body) };
}
export function railHistoricalReceipt(operation, transitionIndex) {
    const entry = operation.transitions[transitionIndex];
    if (entry === undefined)
        corrupt();
    const { integrityHash: _hash, send, ...body } = operation;
    const transitions = operation.transitions.slice(0, transitionIndex + 1);
    const bound = send !== undefined && transitions.some((item) => item.state === "signing_started") ? { send } : {};
    return railReceipt(seal({ ...body, ...bound, ...latest(entry), terminal: TERMINAL.includes(entry.state), transitions }));
}
function intentOf(operation) {
    return { schemaVersion: operation.schemaVersion, kind: operation.kind, operationId: operation.operationId,
        profile: operation.profile, profileHash: operation.profileHash, idempotencyHash: operation.idempotencyHash,
        requestHash: operation.requestHash, account: operation.account, prepared: operation.prepared, policyHash: operation.policyHash };
}
function latest(entry) {
    return { state: entry.state, reason: entry.reason, proofClass: entry.proofClass, transactionId: entry.transactionId,
        rawPayloadHash: entry.rawPayloadHash, evidence: entry.evidence, updatedAt: entry.at };
}
function seal(body) { return validateRailOperation({ ...body, integrityHash: hashObject(body) }); }
function addressShape(value, rail) {
    if (typeof value !== "string" || !(rail === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u : /^T[1-9A-HJ-NP-Za-km-z]{33}$/u).test(value))
        corrupt();
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail operation or evidence binding is invalid."); }
//# sourceMappingURL=rail-operation-model.js.map