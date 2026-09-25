/** Durable Relay effect intent and observation journal. This module cannot sign or submit. */
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay effect journal is invalid: ${reason}.`); }
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", `Relay effect transition refused: ${reason}.`); }
const HASH = /^[a-f0-9]{64}$/u;
const TX = /^0x[a-f0-9]{64}$/u;
const iso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const hexHash = (value) => typeof value === "string" && HASH.test(value);
function body(journal) {
    const { integrityHash: _, ...rest } = journal;
    return rest;
}
function prepared(op) {
    validateRelayUnsignedOperation(op);
    if (op.quote === undefined || op.quote.quoteDigest !== op.quoteDigest)
        blocked("prepared quote required");
}
function validateEffect(effect, role) {
    if (effect.role !== role || !["pending", "signing_started", "sealed", "submitting", "submission_marked", "tx_known", "confirmed", "failed"].includes(effect.phase))
        corrupt("effect role or phase");
    if (role === "deposit" && ["signing_started", "sealed", "submitting"].includes(effect.phase))
        corrupt("deposit approval-only phase");
    if (effect.phase === "pending") {
        if (effect.attempt !== null || effect.observedAt !== null)
            corrupt("pending attempt");
        return;
    }
    if (effect.attempt === null || !hexHash(effect.attempt.marker) || !iso(effect.attempt.markedAt) ||
        (effect.attempt.transactionHash !== null && !TX.test(effect.attempt.transactionHash)) ||
        (effect.attempt.attemptNumber !== undefined && effect.attempt.attemptNumber !== 1))
        corrupt("attempt marker");
    if (role === "approval" && ["signing_started", "sealed", "submitting"].includes(effect.phase) &&
        effect.attempt.attemptNumber !== 1)
        corrupt("approval attempt number");
    if ((effect.phase === "signing_started" || effect.phase === "submission_marked") && (effect.attempt.transactionHash !== null || effect.observedAt !== null))
        corrupt("marked state");
    if (["sealed", "submitting", "tx_known"].includes(effect.phase) && (effect.attempt.transactionHash === null || effect.observedAt !== null))
        corrupt("known transaction");
    if ((effect.phase === "confirmed" || effect.phase === "failed") &&
        (!iso(effect.observedAt) || Date.parse(effect.observedAt) < Date.parse(effect.attempt.markedAt)))
        corrupt("observation");
}
export function validateRelayEffectJournal(value, op) {
    prepared(op);
    if (value === null || typeof value !== "object" || Array.isArray(value))
        corrupt("shape");
    const j = value;
    if (Object.keys(j).sort().join(",") !== ["schemaVersion", "profileHash", "operationId", "preparedIntegrityHash",
        "sourceOwner", "quoteDigest", "orderId", "approvalEnvelope", "depositEnvelope", "effects", "createdAt", "integrityHash"].sort().join(",") ||
        j.schemaVersion !== "apn.relay-effect-journal.v1" || j.profileHash !== op.profileHash ||
        j.operationId !== op.operationId || j.preparedIntegrityHash !== op.integrityHash ||
        j.sourceOwner !== op.sourceAccount || j.quoteDigest !== op.quoteDigest || j.orderId !== op.quote.orderId ||
        hashObject(j.approvalEnvelope) !== hashObject(op.quote.approval) ||
        hashObject(j.depositEnvelope) !== hashObject(op.quote.deposit) || !iso(j.createdAt) ||
        !Array.isArray(j.effects) || j.effects.length !== 2 || !hexHash(j.integrityHash))
        corrupt("binding");
    validateEffect(j.effects[0], "approval");
    validateEffect(j.effects[1], "deposit");
    if (j.effects[1].phase !== "pending" && j.effects[0].phase !== "confirmed")
        corrupt("deposit order");
    if (hashObject(body(j)) !== j.integrityHash)
        corrupt("integrity hash");
    return j;
}
export function createRelayEffectJournal(op, createdAt) {
    prepared(op);
    if (!iso(createdAt))
        blocked("invalid creation time");
    const pending = (role) => ({ role, phase: "pending", attempt: null, observedAt: null });
    const fields = {
        schemaVersion: "apn.relay-effect-journal.v1", profileHash: op.profileHash, operationId: op.operationId,
        preparedIntegrityHash: op.integrityHash, sourceOwner: op.sourceAccount, quoteDigest: op.quoteDigest,
        orderId: op.quote.orderId, approvalEnvelope: op.quote.approval, depositEnvelope: op.quote.deposit,
        effects: [pending("approval"), pending("deposit")], createdAt,
    };
    return validateRelayEffectJournal({ ...fields, integrityHash: hashObject(fields) }, op);
}
/** Pure transition. Once a submission is marked, no transition can mark it again. */
export function advanceRelayEffectJournal(journal, op, event) {
    validateRelayEffectJournal(journal, op);
    const index = event.role === "approval" ? 0 : event.role === "deposit" ? 1 : blocked("role");
    const current = journal.effects[index];
    if (event.role === "deposit" && journal.effects[0].phase !== "confirmed")
        blocked("approval is not confirmed");
    let next;
    switch (event.kind) {
        case "mark_signing":
            if (current.phase !== "pending" || !hexHash(event.marker) || !iso(event.at))
                blocked("duplicate or invalid signing marker");
            next = { ...current, phase: "signing_started", attempt: { marker: event.marker, markedAt: event.at, transactionHash: null, attemptNumber: 1 } };
            break;
        case "seal_signed":
            if (current.phase !== "signing_started" || !TX.test(event.transactionHash))
                blocked("signed hash requires signing marker");
            next = { ...current, phase: "sealed", attempt: { ...current.attempt, transactionHash: event.transactionHash } };
            break;
        case "mark_submitting":
            if (current.phase !== "sealed" || !iso(event.at) || Date.parse(event.at) < Date.parse(current.attempt.markedAt))
                blocked("submission requires sealed effect");
            next = { ...current, phase: "submitting" };
            break;
        case "mark_submission":
            if (current.phase !== "pending" || !hexHash(event.marker) || !iso(event.at))
                blocked("duplicate or invalid submission marker");
            next = { ...current, phase: "submission_marked", attempt: { marker: event.marker, markedAt: event.at, transactionHash: null } };
            break;
        case "record_transaction":
            if (current.phase !== "submission_marked" || !TX.test(event.transactionHash))
                blocked("transaction hash requires one marked attempt");
            next = { ...current, phase: "tx_known", attempt: { ...current.attempt, transactionHash: event.transactionHash } };
            break;
        case "observe":
            if ((current.phase !== "submission_marked" && current.phase !== "tx_known" && current.phase !== "submitting") || !iso(event.at) ||
                Date.parse(event.at) < Date.parse(current.attempt.markedAt))
                blocked("observation requires a marked attempt");
            next = { ...current, phase: event.outcome, observedAt: event.at };
            break;
    }
    const effects = [...journal.effects];
    effects[index] = next;
    const fields = { ...body(journal), effects };
    return validateRelayEffectJournal({ ...fields, integrityHash: hashObject(fields) }, op);
}
export function relayRecoveryClass(journal, op) {
    validateRelayEffectJournal(journal, op);
    const [approval, deposit] = journal.effects;
    if (approval.phase === "failed" || deposit.phase === "failed")
        return "failed";
    if (deposit.phase === "confirmed")
        return "completed";
    if (deposit.phase !== "pending" || ["signing_started", "sealed", "submitting", "submission_marked", "tx_known"].includes(approval.phase))
        return "observation_only";
    return approval.phase === "confirmed" ? "approval_confirmed" : "not_started";
}
export class RelayEffectJournalRepository extends SecureStateStore {
    preparedOperations = new RelayUnsignedOperationRepository(this.root);
    path(profileHash, operationId) {
        stateIdentifier(profileHash, "Relay effect profile");
        stateIdentifier(operationId, "Relay effect operation");
        return `relay-effect-journals/${profileHash}/${operationId}.json`;
    }
    async operation(profileHash, operationId) {
        const op = await this.preparedOperations.loadOperation(profileHash, operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared Relay operation was not found.");
        return op;
    }
    async load(profileHash, operationId) {
        const op = await this.operation(profileHash, operationId);
        const value = await this.readJson(this.path(profileHash, operationId));
        return value === null ? null : validateRelayEffectJournal(value, op);
    }
    async create(profileHash, operationId, createdAt) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `relay-effect:${profileHash}:${operationId}`], async () => {
            const op = await this.operation(profileHash, operationId);
            if (await new RelayRetirementRepository(this.root).load(op) !== null)
                blocked("operation is retired");
            const path = this.path(profileHash, operationId);
            if (await this.readJson(path) !== null)
                blocked("journal already exists");
            const journal = createRelayEffectJournal(op, createdAt);
            await this.ensureDirectory(`relay-effect-journals/${profileHash}`);
            await this.writeJson(path, journal, true);
            return journal;
        });
    }
    async transition(profileHash, operationId, expectedIntegrityHash, event) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `relay-effect:${profileHash}:${operationId}`], async () => {
            const op = await this.operation(profileHash, operationId);
            if (await new RelayRetirementRepository(this.root).load(op) !== null)
                blocked("operation is retired");
            const path = this.path(profileHash, operationId);
            const value = await this.readJson(path);
            if (value === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay effect journal was not found.");
            const current = validateRelayEffectJournal(value, op);
            if (current.integrityHash !== expectedIntegrityHash)
                blocked("stale journal revision");
            const next = advanceRelayEffectJournal(current, op, event);
            await this.writeJson(path, next);
            return next;
        });
    }
}
//# sourceMappingURL=effect-journal.js.map