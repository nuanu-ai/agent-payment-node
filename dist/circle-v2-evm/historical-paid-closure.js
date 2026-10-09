import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assetUsageReservationId, validateAssetUsageReservation } from "../asset-usage-ledger-record.js";
import { SecureStateStore } from "../secure-state-store.js";
import { verifyCircleDeployments } from "./preflight.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_RECIPIENT, circleRoute } from "./catalog.js";
import { circleBlocked, validateCircle } from "./operation-model.js";
import { CircleExternalStore } from "./external-store.js";
import { CircleRepository } from "./repository.js";
import { verifyHistoricalPaidSource, historicalPaidSourceBody, HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { verifyHistoricalPaidDestination } from "./historical-paid-destination.js";
import { externalClaimKey, validateExternalFulfillment } from "./external-proof.js";
export function detachedHistorical(value) { const copy = structuredClone(value); const freeze = (v) => { if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
} }; freeze(copy); return copy; }
const certificates = new WeakMap();
function stableProof(value) { const { finalityBlockHash: _h, finalityBlockNumberAtomic: _n, integrityHash: _i, ...body } = value; return body; }
function rowBinding(row) { const { state: _s, updatedAt: _u, effectAt: _e, outcomeDigest: _o, reservationDigest: _d, consumedAtomic: _c, ...identity } = row; return identity; }
function immutableFrame(op) { const { integrityHash: _i, transitions: _t, state: _s, terminal: _terminal, source: _src, destination: _dst, externalFulfillment: _external, usageFinalized: _final, usage, effects, ...frame } = op; return { ...frame, usage: usage.map(rowBinding), effects: effects.map(e => { const { proof: _p, ...effect } = e; return effect; }) }; }
function validateRoster(op) {
    const route = circleRoute(op.destinationChain, op.destinationProfile), names = ["usdc", "approval-native", "burn-native", "cleanup-native", "mint-native"], caps = ["40100", "30000000000000", "30000000000000", "15000000000000", route.destinationNativeCap];
    if (op.usage.length !== 5)
        circleBlocked("historical_paid_usage_roster");
    for (const [i, row] of op.usage.entries()) {
        validateAssetUsageReservation(row);
        const destination = i === 4, account = destination ? op.destinationCustody.walletAddress : op.sourceCustody.walletAddress, chain = `eip155:${destination ? op.destinationChain : 42161}`, asset = i === 0 ? { kind: "token", identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native", identifier: null }, policy = op.policies.find(p => p.profile === (destination ? op.destinationProfile : op.profile));
        if (row.account !== account || row.chain !== chain || canonicalJson(row.asset) !== canonicalJson(asset) || row.amountAtomic !== caps[i] || row.policyDigest !== policy?.policyDigest || row.rail !== "bridge" || row.reservationId !== assetUsageReservationId({ account, chain, asset }, `circle-v2-evm.v1:${op.operationId}:${names[i]}`))
            circleBlocked("historical_paid_usage_roster");
    }
}
function assertSaved(saved, op) {
    if (!isPlainRecord(saved) || !exactKeys(saved, ["schemaVersion", "originalOperation", "originalOperationDigest", "source", "destination", "externalFulfillment", "readCounts", "outcomes", "proofHash"]))
        circleBlocked("historical_paid_closure_shape");
    const { proofHash, ...body } = saved;
    validateCircle(saved.originalOperation);
    validateRoster(saved.originalOperation);
    if (saved.schemaVersion !== "apn.circle-historical-paid-closure.v1" || hashObject(body) !== proofHash || hashObject(saved.originalOperation) !== saved.originalOperationDigest || hashObject(immutableFrame(saved.originalOperation)) !== hashObject(immutableFrame(op)) || canonicalJson(saved.originalOperation.transitions) !== canonicalJson(op.transitions.slice(0, saved.originalOperation.transitions.length)))
        circleBlocked("historical_paid_closure_original_frame");
    if (op.operationId === HISTORICAL_LINEA_OPERATION && (saved.externalFulfillment !== null || saved.destination.kind !== "owned_linea") || op.operationId === HISTORICAL_MONAD_OPERATION && (saved.externalFulfillment === null || saved.destination.kind !== "external_monad"))
        circleBlocked("historical_paid_accounting_classification");
    if (canonicalJson(saved.outcomes) !== canonicalJson(outcomes(saved.originalOperation, saved.source, saved.destination, saved.externalFulfillment)))
        circleBlocked("historical_paid_closure_outcomes");
    for (const old of saved.originalOperation.effects) {
        const current = op.effects.find(e => e.role === old.role);
        if (old.proof !== null && ["safe", "finalized"].includes(old.proof.finalityTag) && canonicalJson(current.proof) !== canonicalJson(old.proof))
            circleBlocked("historical_paid_frozen_proof_changed");
    }
}
export class HistoricalPaidClosureStore extends SecureStateStore {
    async load(op) { const x = await this.readJson(`circle-historical-paid-closure/${op.operationId}.json`); if (x === null)
        return null; const saved = x; assertSaved(saved, op); return detachedHistorical(saved); }
    async create(op, closure) { assertSaved(closure, op); const prior = await this.load(op); if (prior !== null) {
        if (canonicalJson(prior) !== canonicalJson(closure))
            circleBlocked("historical_paid_closure_replacement");
        return;
    } await this.initialize(); await this.ensureDirectory("circle-historical-paid-closure"); await this.writeJson(`circle-historical-paid-closure/${op.operationId}.json`, closure, true); }
}
async function durable(state, op) { const saved = await new CircleRepository(state.root).load(op.operationId); if (saved === null || canonicalJson(saved) !== canonicalJson(op))
    circleBlocked("historical_paid_settlement_durable_frame"); }
function externalProof(op, source, destination) {
    const route = circleRoute(op.destinationChain, op.destinationProfile), receipt = destination.receipt, body = { schemaVersion: "apn.circle-external-fulfillment.v1", operationId: op.operationId, fingerprint: op.fingerprint, sourceTransactionHash: source.sourceProof.transactionHash, sourceMessageHash: source.sourceProof.sourceMessageHash, attestedMessageHash: op.attestation.hash, nonce: op.attestation.nonce, destinationChain: op.destinationChain, recipient: CIRCLE_RECIPIENT, token: route.token, grossAtomic: "40100", issuerFeeAtomic: op.attestation.feeExecutedAtomic, netAtomic: op.attestation.receivedAtomic, caller: destination.caller, controlledDestinationNativeAtomic: "0", sourceApprovalActualFeeAtomic: source.approvalProof.actualFeeAtomic, sourceBurnActualFeeAtomic: source.sourceProof.actualFeeAtomic, destinationReceipt: receipt, sourceFinality: source.sourceProof, recipientBalance: { parentHash: destination.parentHash, parentNumberAtomic: destination.parentNumberAtomic, before: destination.beforeAtomic, after: destination.afterAtomic, delta: op.attestation.receivedAtomic }, historicalDeploymentDigest: destination.historicalDeploymentDigest, claimDigest: externalClaimKey(op), evidenceHash: hashObject({ source, destination }) };
    return { ...body, proofHash: hashObject(body) };
}
function outcomes(op, source, destination, external) {
    const isExternal = op.operationId === HISTORICAL_MONAD_OPERATION;
    if (isExternal !== (external !== null))
        circleBlocked("historical_paid_accounting_classification");
    return op.usage.map((reservation, index) => {
        const state = isExternal && index >= 3 ? "released_unsubmitted" : !isExternal && index === 3 ? "failed_confirmed_revert" : "finalized";
        const outcomeDigest = external !== null ? hashObject({ kind: "circle_external_mint_fulfillment", operationId: op.operationId, fingerprint: op.fingerprint, proofHash: external.proofHash, reservationId: reservation.reservationId, index, state }) : hashObject({ operationId: op.operationId, target: "finalized", source: source.sourceProof.sourceMessageHash, destination: destination.receipt.transactionHash, cleanup: op.effects.find(e => e.role === "cleanup")?.transactionHash ?? null, reservation: reservation.reservationId });
        return { reservation, state, consumedAtomic: !isExternal && index === 3 ? source.cleanupProof?.actualFeeAtomic ?? "0" : null, outcomeDigest };
    });
}
/** No JSON evidence input exists: source and destination must both be freshly verified here. */
export async function verifyHistoricalPaidClosure(state, input, source, destination) {
    const op = detachedHistorical(input);
    await durable(state, op);
    validateRoster(op);
    if (![HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION].includes(op.operationId))
        circleBlocked("historical_paid_exact_operation");
    const store = new HistoricalPaidClosureStore(state.root), saved = await store.load(op), sourceToken = await verifyHistoricalPaidSource(state, op, source), bound = await historicalPaidSourceBody(sourceToken, state, op), freshDestination = await verifyHistoricalPaidDestination(state, bound.operation, bound.evidence, source, destination);
    let closure;
    if (saved !== null) {
        if (canonicalJson(stableProof(saved.source.sourceProof)) !== canonicalJson(stableProof(bound.evidence.sourceProof)) || canonicalJson(stableProof(saved.source.approvalProof)) !== canonicalJson(stableProof(bound.evidence.approvalProof)) || canonicalJson(stableProof(saved.destination.receipt)) !== canonicalJson(stableProof(freshDestination.receipt)) || saved.destination.beforeAtomic !== freshDestination.beforeAtomic || saved.destination.afterAtomic !== freshDestination.afterAtomic)
            circleBlocked("historical_paid_saved_canonical_proof_changed");
        const reanchored = new Set();
        for (const [rpc, proof] of [[source, saved.source.sourceProof], [source, saved.source.approvalProof], [destination, saved.destination.receipt]]) {
            const key = canonicalJson({ endpoint: rpc.readEndpoint(), chain: rpc.chainId, number: proof.finalityBlockNumberAtomic, hash: proof.finalityBlockHash });
            if (reanchored.has(key))
                continue;
            reanchored.add(key);
            const head = await rpc.block("0x" + BigInt(proof.finalityBlockNumberAtomic).toString(16));
            if (String(head.hash).toLowerCase() !== proof.finalityBlockHash || BigInt(String(head.number)).toString() !== proof.finalityBlockNumberAtomic)
                circleBlocked("historical_paid_saved_head_reorg");
        }
        if (saved.externalFulfillment !== null) {
            const authenticated = externalProof(op, bound.evidence, freshDestination), prior = saved.externalFulfillment;
            validateExternalFulfillment(prior, { ...op, source: bound.evidence.sourceProof });
            const identity = (p) => { const { proofHash: _p, evidenceHash: _e, sourceFinality: _s, destinationReceipt: _d, historicalDeploymentDigest: _h, ...body } = p; return body; };
            if (canonicalJson(identity(prior)) !== canonicalJson(identity(authenticated)) || canonicalJson(stableProof(prior.sourceFinality)) !== canonicalJson(stableProof(authenticated.sourceFinality)) || canonicalJson(stableProof(prior.destinationReceipt)) !== canonicalJson(stableProof(authenticated.destinationReceipt)) || prior.historicalDeploymentDigest !== verifyCircleDeployments(saved.destination.sourceCurrentDeployment, saved.destination.historicalDeployment))
                circleBlocked("historical_paid_external_classification_proof");
        }
        closure = saved;
    }
    else {
        const external = op.operationId === HISTORICAL_MONAD_OPERATION ? op.externalFulfillment ?? await new CircleExternalStore(state.root).readClaim(op) ?? externalProof(op, bound.evidence, freshDestination) : null;
        if (external !== null) {
            validateExternalFulfillment(external, { ...op, source: bound.evidence.sourceProof });
            const fresh = externalProof(op, bound.evidence, freshDestination);
            if (external.caller !== fresh.caller || canonicalJson(stableProof(external.sourceFinality)) !== canonicalJson(stableProof(fresh.sourceFinality)) || canonicalJson(stableProof(external.destinationReceipt)) !== canonicalJson(stableProof(fresh.destinationReceipt)) || external.recipientBalance.before !== fresh.recipientBalance.before || external.recipientBalance.after !== fresh.recipientBalance.after)
                circleBlocked("historical_paid_external_classification_proof");
        }
        const body = { schemaVersion: "apn.circle-historical-paid-closure.v1", originalOperation: op, originalOperationDigest: hashObject(op), source: bound.evidence, destination: freshDestination, externalFulfillment: external, readCounts: { source: source.counts(), destination: destination.counts() }, outcomes: outcomes(op, bound.evidence, freshDestination, external) };
        closure = detachedHistorical({ ...body, proofHash: hashObject(body) });
    }
    if (hashObject(input) !== hashObject(op))
        circleBlocked("historical_paid_caller_frame_changed");
    source.assertReadDeadline();
    destination.assertReadDeadline();
    await durable(state, op);
    await store.create(op, closure);
    await durable(state, op);
    const token = Object.freeze({ kind: "verified-historical-paid-closure" });
    certificates.set(token, { state, root: state.root, operation: op, operationDigest: hashObject(op), closure, assertFresh: () => { source.assertReadDeadline(); destination.assertReadDeadline(); } });
    return token;
}
/** One use, full durable frame check before the consumer's first ledger read, retained frozen values only. */
export async function consumeHistoricalPaidClosure(token, state, input) {
    const op = detachedHistorical(input), body = certificates.get(token);
    certificates.delete(token);
    if (body === undefined || body.state !== state || body.root !== state.root || body.operationDigest !== hashObject(op))
        circleBlocked("historical_paid_private_settlement_required");
    body.assertFresh();
    await durable(state, body.operation);
    const saved = await new HistoricalPaidClosureStore(state.root).load(body.operation);
    if (saved === null || canonicalJson(saved) !== canonicalJson(body.closure))
        circleBlocked("historical_paid_durable_closure_changed");
    if (hashObject(input) !== body.operationDigest)
        circleBlocked("historical_paid_caller_frame_changed");
    body.assertFresh();
    return Object.freeze({ operation: body.operation, closure: body.closure });
}
//# sourceMappingURL=historical-paid-closure.js.map