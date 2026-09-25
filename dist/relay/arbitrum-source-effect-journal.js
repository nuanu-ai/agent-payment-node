/** Offline Arbitrum source effect ledger. No signer, broadcaster, command, or RPC is installed. */
import { randomBytes } from "node:crypto";
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";
const HASH = /^[a-f0-9]{64}$/u;
const TX = /^0x(?:[a-fA-F0-9]{2})+$/u;
const UINT = /^(0|[1-9][0-9]*)$/u;
const BLOCK_HASH = /^0x[a-f0-9]{64}$/u;
const phases = ["pending", "signing_started", "sealed", "submitting",
    "submitted", "unknown_finality", "confirmed", "failed", "approval_skipped"];
const iso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
const exact = (value, names) => Object.keys(value).sort().join() === [...names].sort().join();
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum effect transition refused.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", "Relay Arbitrum source effect journal is invalid.", { reason }); }
function fields(journal) {
    const { integrityHash: _, ...rest } = journal;
    return rest;
}
function operationDraft(op) {
    validateRelayUnsignedOperation(op);
    if (op.sourceChainId !== 42161 || op.destinationChainId !== 1 || op.arbitrumDraft === undefined ||
        op.arbitrumDraft.executionAdmitted !== false)
        blocked("exact_unsigned_arbitrum_operation_required");
    return op.arbitrumDraft;
}
function effectEnvelope(op, role) {
    const steps = op.arbitrumDraft.rawQuote.steps;
    // The durable operation repository re-decodes the entire quote before any repository read/write.
    return steps[role === "approval" ? 0 : 1].items[0].data;
}
function validSkipProof(proof, op, createdAt) {
    const draft = op.arbitrumDraft;
    return exact(proof, ["proofClass", "operationIntegrityHash", "policyDigest", "policyRevision", "token",
        "owner", "spender", "amountAtomic", "allowanceAtomic", "blockNumber", "blockHash", "observedAt"]) &&
        proof.proofClass === "canonical_allowance_observation" && proof.operationIntegrityHash === op.integrityHash &&
        proof.policyDigest === draft.policyDigest && proof.policyRevision === draft.policyRevision &&
        same(proof.token, RELAY_ARBITRUM_USDC) && same(proof.owner, op.sourceAccount) &&
        same(proof.spender, ETHEREUM_DEPOSITORY) && proof.amountAtomic === op.amountAtomic &&
        UINT.test(proof.allowanceAtomic) && BigInt(proof.allowanceAtomic) >= BigInt(op.amountAtomic) &&
        UINT.test(proof.blockNumber) && BLOCK_HASH.test(proof.blockHash) &&
        proof.blockHash !== `0x${"0".repeat(64)}` && iso(proof.observedAt) &&
        Date.parse(proof.observedAt) >= Date.parse(createdAt) && Date.parse(proof.observedAt) < Date.parse(op.deadline);
}
async function verifySigned(op, role, raw, nonce) {
    if (!TX.test(raw) || raw.length > 16_386 || !UINT.test(nonce))
        corrupt("signed_encoding_or_nonce");
    let tx, signer;
    try {
        tx = parseTransaction(raw);
        signer = await recoverTransactionAddress({ serializedTransaction: raw });
    }
    catch {
        corrupt("signed_decode");
    }
    const envelope = effectEnvelope(op, role);
    const ceiling = role === "approval" ? op.approvalNetworkFeeCeilingWei : op.depositNetworkFeeCeilingWei;
    if (tx.type !== "eip1559" || tx.chainId !== 42161 || !same(signer, op.sourceAccount) ||
        !same(tx.to ?? "", envelope.to) || !same(tx.data ?? "0x", envelope.data) ||
        (tx.value ?? 0n) !== BigInt(envelope.value) || tx.gas !== BigInt(envelope.gas) ||
        tx.maxFeePerGas !== BigInt(envelope.maxFeePerGas) ||
        (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(envelope.maxPriorityFeePerGas) ||
        tx.nonce === undefined || BigInt(tx.nonce) !== BigInt(nonce) ||
        (tx.accessList?.length ?? 0) !== 0 || ceiling === undefined ||
        tx.gas * tx.maxFeePerGas > BigInt(ceiling))
        corrupt("signed_envelope_drift");
    return keccak256(raw);
}
function shape(j, op) {
    const draft = operationDraft(op);
    if (!exact(j, ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash", "quoteDigest", "orderId",
        "owner", "approvalEnvelopeHash", "depositEnvelopeHash", "effects", "createdAt", "integrityHash"]) ||
        j.schemaVersion !== "apn.relay-arbitrum-source-effect-journal.v1" ||
        j.profileHash !== op.profileHash || j.operationId !== op.operationId ||
        j.operationIntegrityHash !== op.integrityHash || j.quoteDigest !== draft.quoteDigest ||
        j.orderId !== draft.orderId || j.owner !== op.sourceAccount ||
        j.approvalEnvelopeHash !== hashObject(effectEnvelope(op, "approval")) ||
        j.depositEnvelopeHash !== hashObject(effectEnvelope(op, "deposit")) ||
        !iso(j.createdAt) || !Array.isArray(j.effects) || j.effects.length !== 2 ||
        !HASH.test(j.integrityHash) || j.integrityHash !== hashObject(fields(j)))
        corrupt("binding");
    for (const [index, role] of ["approval", "deposit"].entries()) {
        const effect = j.effects[index];
        if (effect === undefined || !exact(effect, effect.phase === "approval_skipped" ?
            ["role", "phase", "attempt", "skipProof"] : ["role", "phase", "attempt"]) || effect.role !== role ||
            !phases.includes(effect.phase))
            corrupt("effect_shape");
        if (effect.phase === "approval_skipped") {
            if (role !== "approval" || effect.attempt !== null || effect.skipProof === undefined ||
                !validSkipProof(effect.skipProof, op, j.createdAt))
                corrupt("approval_skip_proof");
            continue;
        }
        if (effect.phase === "pending") {
            if (effect.attempt !== null)
                corrupt("pending_attempt");
            continue;
        }
        const a = effect.attempt;
        if (a === null || !exact(a, ["marker", "markedAt", "rawTransaction", "transactionHash", "nonce",
            "submittingAt", "observationDigest"]) || !HASH.test(a.marker) || !iso(a.markedAt) ||
            Date.parse(a.markedAt) < Date.parse(j.createdAt))
            corrupt("attempt_shape");
        if (effect.phase === "signing_started") {
            if (a.rawTransaction !== null || a.transactionHash !== null || a.nonce !== null ||
                a.submittingAt !== null || a.observationDigest !== null)
                corrupt("signing_marker");
            continue;
        }
        if (typeof a.rawTransaction !== "string" || !TX.test(a.rawTransaction) || a.rawTransaction.length > 16_386 ||
            typeof a.transactionHash !== "string" || a.transactionHash !== keccak256(a.rawTransaction) ||
            typeof a.nonce !== "string" || !UINT.test(a.nonce))
            corrupt("signed_material");
        if (effect.phase === "sealed" ? a.submittingAt !== null : !iso(a.submittingAt) ||
            Date.parse(a.submittingAt) < Date.parse(a.markedAt))
            corrupt("submitting_marker");
        if (["confirmed", "failed"].includes(effect.phase) ? !HASH.test(a.observationDigest ?? "") :
            a.observationDigest !== null)
            corrupt("observation_binding");
    }
    if (j.effects[1].phase !== "pending" && j.effects[0].phase !== "confirmed")
        corrupt("deposit_order");
    const approvalNonce = j.effects[0].attempt?.nonce;
    const depositNonce = j.effects[1].attempt?.nonce;
    if (approvalNonce !== null && approvalNonce !== undefined && depositNonce !== null && depositNonce !== undefined &&
        BigInt(depositNonce) <= BigInt(approvalNonce))
        corrupt("nonce_order");
}
export async function validateArbitrumSourceEffectJournal(value, op) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        corrupt("journal_shape");
    const j = value;
    try {
        shape(j, op);
        for (const effect of j.effects) {
            if (effect.attempt?.rawTransaction !== null && effect.attempt?.rawTransaction !== undefined &&
                await verifySigned(op, effect.role, effect.attempt.rawTransaction, effect.attempt.nonce) !== effect.attempt.transactionHash)
                corrupt("signed_hash");
        }
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT")
            throw error;
        corrupt("journal_decode");
    }
    return j;
}
export async function createArbitrumSourceEffectJournal(op, createdAt) {
    operationDraft(op);
    if (!iso(createdAt))
        blocked("creation_time");
    const pending = (role) => ({ role, phase: "pending", attempt: null });
    const data = { schemaVersion: "apn.relay-arbitrum-source-effect-journal.v1",
        profileHash: op.profileHash, operationId: op.operationId, operationIntegrityHash: op.integrityHash,
        quoteDigest: op.quoteDigest, orderId: op.arbitrumDraft.orderId, owner: op.sourceAccount,
        approvalEnvelopeHash: hashObject(effectEnvelope(op, "approval")),
        depositEnvelopeHash: hashObject(effectEnvelope(op, "deposit")),
        effects: [pending("approval"), pending("deposit")], createdAt };
    return validateArbitrumSourceEffectJournal({ ...data, integrityHash: hashObject(data) }, op);
}
export async function advanceArbitrumSourceEffectJournal(j, op, event) {
    await validateArbitrumSourceEffectJournal(j, op);
    const index = event.role === "approval" ? 0 : event.role === "deposit" ? 1 : blocked("role");
    const current = j.effects[index];
    if (event.role === "deposit" && j.effects[0].phase !== "confirmed")
        blocked("approval_not_confirmed");
    let next;
    switch (event.kind) {
        case "begin_signing":
            if (current.phase !== "pending" || !HASH.test(event.marker) || !iso(event.at) ||
                Date.parse(event.at) < Date.parse(j.createdAt))
                blocked("duplicate_or_invalid_signing_marker");
            next = { role: event.role, phase: "signing_started", attempt: { marker: event.marker, markedAt: event.at,
                    rawTransaction: null, transactionHash: null, nonce: null, submittingAt: null, observationDigest: null } };
            break;
        case "seal_signed": {
            if (current.phase !== "signing_started")
                blocked("signed_material_requires_marker");
            const hash = await verifySigned(op, event.role, event.rawTransaction, event.nonce);
            next = { role: event.role, phase: "sealed", attempt: { ...current.attempt, rawTransaction: event.rawTransaction,
                    transactionHash: hash, nonce: event.nonce } };
            break;
        }
        case "mark_submitting":
            if (current.phase !== "sealed" || !iso(event.at) ||
                Date.parse(event.at) < Date.parse(current.attempt.markedAt))
                blocked("submitting_requires_seal");
            next = { role: event.role, phase: "submitting", attempt: { ...current.attempt, submittingAt: event.at } };
            break;
        case "record_send":
            if (current.phase !== "submitting" || !["accepted", "uncertain"].includes(event.outcome))
                blocked("send_outcome_requires_submitting");
            next = { ...current, phase: event.outcome === "accepted" ? "submitted" : "unknown_finality" };
            break;
        case "record_verified_observation":
            if (!["submitting", "submitted", "unknown_finality"].includes(current.phase) ||
                !HASH.test(event.proofDigest) || !["confirmed", "failed"].includes(event.outcome))
                blocked("verified_observation_required");
            next = { role: event.role, phase: event.outcome, attempt: { ...current.attempt, observationDigest: event.proofDigest } };
            break;
    }
    const effects = [...j.effects];
    effects[index] = next;
    const data = { ...fields(j), effects };
    return validateArbitrumSourceEffectJournal({ ...data, integrityHash: hashObject(data) }, op);
}
export async function arbitrumSourceRecoveryClass(j, op) {
    await validateArbitrumSourceEffectJournal(j, op);
    const [approval, deposit] = j.effects;
    if (approval.phase === "failed" || deposit.phase === "failed")
        return "failed";
    if (deposit.phase === "confirmed")
        return "completed";
    if (approval.phase === "approval_skipped")
        return "approval_skipped";
    if (deposit.phase !== "pending" || ["signing_started", "sealed", "submitting", "submitted", "unknown_finality"].includes(approval.phase))
        return "observation_only";
    return approval.phase === "confirmed" ? "approval_confirmed" : "not_started";
}
export class ArbitrumSourceEffectJournalRepository extends SecureStateStore {
    verifiedObservation;
    verifiedAllowance;
    clock;
    constructor(root, verifiedObservation, verifiedAllowance, clock = () => new Date()) {
        super(root);
        this.verifiedObservation = verifiedObservation;
        this.verifiedAllowance = verifiedAllowance;
        this.clock = clock;
    }
    operations = new RelayUnsignedOperationRepository(this.root);
    path(profileHash, operationId) {
        stateIdentifier(profileHash, "Relay Arbitrum effect profile");
        stateIdentifier(operationId, "Relay Arbitrum effect operation");
        return `relay-arbitrum-source-effect-journals/${profileHash}/${operationId}.json`;
    }
    async operation(profileHash, operationId) {
        const op = await this.operations.loadOperation(profileHash, operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum prepared operation was not found.");
        operationDraft(op);
        return op;
    }
    async load(profileHash, operationId) {
        const op = await this.operation(profileHash, operationId);
        const data = await this.readJson(this.path(profileHash, operationId));
        return data === null ? null : validateArbitrumSourceEffectJournal(data, op);
    }
    async create(profileHash, operationId, createdAt) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `relay-arbitrum-effect:${operationId}`], async () => {
            const op = await this.operation(profileHash, operationId), path = this.path(profileHash, operationId);
            if (await new RelayRetirementRepository(this.root).load(op) !== null)
                blocked("operation_retired");
            if (await this.readJson(path) !== null)
                blocked("journal_already_exists");
            const j = await createArbitrumSourceEffectJournal(op, createdAt);
            await this.ensureDirectory(`relay-arbitrum-source-effect-journals/${profileHash}`);
            await this.writeJson(path, j, true);
            return j;
        });
    }
    async transition(profileHash, operationId, expectedIntegrityHash, event) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `relay-arbitrum-effect:${operationId}`], async () => {
            const op = await this.operation(profileHash, operationId), path = this.path(profileHash, operationId);
            if (await new RelayRetirementRepository(this.root).load(op) !== null)
                blocked("operation_retired");
            const data = await this.readJson(path);
            if (data === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum source effect journal was not found.");
            const j = await validateArbitrumSourceEffectJournal(data, op);
            if (j.integrityHash !== expectedIntegrityHash)
                blocked("stale_journal_revision");
            if (event.kind === "record_verified_observation" &&
                (this.verifiedObservation === undefined || !(await this.verifiedObservation({ operation: op,
                    journal: j, role: event.role, outcome: event.outcome, proofDigest: event.proofDigest }))))
                blocked("verified_observation_unavailable");
            const next = await advanceArbitrumSourceEffectJournal(j, op, event);
            await this.writeJson(path, next);
            return next;
        });
    }
    async beginSigning(profileHash, operationId, expectedIntegrityHash, role, at) {
        return this.transition(profileHash, operationId, expectedIntegrityHash, { kind: "begin_signing", role, marker: randomBytes(32).toString("hex"), at });
    }
    /** Only a separately wired canonical read may create this proof. It does not authorize deposit dispatch. */
    async skipApproval(profileHash, operationId, expectedIntegrityHash) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `relay-arbitrum-effect:${operationId}`], async () => {
            const op = await this.operation(profileHash, operationId), path = this.path(profileHash, operationId);
            if (await new RelayRetirementRepository(this.root).load(op) !== null)
                blocked("operation_retired");
            const data = await this.readJson(path);
            if (data === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum source effect journal was not found.");
            const j = await validateArbitrumSourceEffectJournal(data, op);
            if (j.integrityHash !== expectedIntegrityHash)
                blocked("stale_journal_revision");
            if (j.effects[0].phase !== "pending" || j.effects[1].phase !== "pending")
                blocked("approval_already_started");
            if (this.verifiedAllowance === undefined)
                blocked("canonical_allowance_verifier_unavailable");
            const read = await this.verifiedAllowance({ operation: op, journal: j });
            const now = this.clock();
            if (read === null || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
                !iso(read.observedAt) || Date.parse(read.observedAt) > now.getTime() ||
                now.getTime() - Date.parse(read.observedAt) > 30_000 ||
                now.getTime() + 60_000 >= Date.parse(op.deadline))
                blocked("fresh_canonical_allowance_unavailable");
            const proof = { proofClass: "canonical_allowance_observation",
                operationIntegrityHash: op.integrityHash, policyDigest: read.policyDigest,
                policyRevision: read.policyRevision, token: RELAY_ARBITRUM_USDC,
                owner: op.sourceAccount, spender: ETHEREUM_DEPOSITORY, amountAtomic: op.amountAtomic,
                allowanceAtomic: read.allowanceAtomic, blockNumber: read.blockNumber,
                blockHash: read.blockHash, observedAt: read.observedAt };
            if (!validSkipProof(proof, op, j.createdAt))
                blocked("allowance_or_policy_mismatch");
            const effects = [
                { role: "approval", phase: "approval_skipped", attempt: null, skipProof: proof }, j.effects[1]
            ];
            const body = { ...fields(j), effects };
            const next = await validateArbitrumSourceEffectJournal({ ...body, integrityHash: hashObject(body) }, op);
            await this.writeJson(path, next);
            return next;
        });
    }
}
//# sourceMappingURL=arbitrum-source-effect-journal.js.map