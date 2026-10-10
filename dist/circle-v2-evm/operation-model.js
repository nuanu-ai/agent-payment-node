import { validateExternalFulfillment } from "./external-proof.js";
import { validateCircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { assertCircleSource, assertCircleAttestation, encodeCircleApproval, encodeCircleBurn, encodeCircleMint } from "./protocol.js";
export function circleBlocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", `Circle EVM operation blocked: ${reason}.`, { reason }); }
export function circleCorrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Circle EVM journal is invalid: ${reason}.`, { reason }); }
export function sealCircle(input) {
    const { integrityHash: _old, ...body } = input;
    return { ...body, integrityHash: hashObject(body) };
}
export function advanceCircle(op, patch, reason, now) {
    const { transitions, integrityHash: _old, ...body } = { ...op, ...patch };
    const entry = { sequence: transitions.length, at: new Date(now).toISOString(), reason, previousHash: op.transitions.at(-1)?.snapshotHash ?? null, snapshotHash: hashObject(body) };
    return sealCircle({ ...body, transitions: [...transitions, entry] });
}
export function circleEnvelope(input) { return { ...input, envelopeHash: hashObject(input) }; }
export function validateCircleEnvelope(e, role, chain, attestation, destinationProfile) {
    if (!isPlainRecord(e) || !exactKeys(e, ["chainId", "from", "to", "data", "valueAtomic", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"]))
        circleCorrupt("envelope_shape");
    const { envelopeHash, ...body } = e, route = circleRoute(chain, destinationProfile), destination = role === "mint";
    const data = destination ? attestation === null ? null : encodeCircleMint(attestation) : role === "burn" ? encodeCircleBurn(chain) : encodeCircleApproval(role === "cleanup");
    if (envelopeHash !== hashObject(body) || e.chainId !== (destination ? chain : 42161) || e.from !== (destination ? route.gasPayer : CIRCLE_SOURCE_OWNER) ||
        e.to !== (destination ? CIRCLE_TRANSMITTER : role === "burn" ? CIRCLE_MESSENGER : CIRCLE_SOURCE_TOKEN) || e.data !== data || e.valueAtomic !== "0")
        circleCorrupt("envelope_binding");
    for (const field of [e.nonceAtomic, e.gasLimitAtomic, e.maxFeePerGasAtomic, e.maxPriorityFeePerGasAtomic])
        if (!/^(?:0|[1-9][0-9]{0,77})$/u.test(field) || BigInt(field) >= 1n << 256n)
            circleCorrupt("envelope_quantity");
    if (BigInt(e.nonceAtomic) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(e.gasLimitAtomic) < 1n || BigInt(e.gasLimitAtomic) > (role === "approval" || role === "cleanup" ? 100000n : 600000n) ||
        BigInt(e.maxFeePerGasAtomic) === 0n || BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic) ||
        BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) > BigInt(destination ? route.destinationNativeCap : role === "cleanup" ? "15000000000000" : "30000000000000"))
        circleCorrupt("envelope_fee_cap");
}
export function validateCircle(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profile", "profileHash", "destinationProfile", "destinationProfileHash", "idempotencyHash", "requestHash", "fingerprint", "destinationChain", "sourceCustody", "destinationCustody", "policies", "preparedAt", "expiresAt", "deploymentDigest", "feeQuoteAtomic", "state", "terminal", "effects", "source", "attestation", "destination", "residualAllowanceAtomic", "usage", "usageFinalized", "transitions", "integrityHash", ...(value.nonceRetirement === undefined ? [] : ["nonceRetirement"]), ...(value.externalFulfillment === undefined ? [] : ["externalFulfillment"])]))
        circleCorrupt("shape");
    const op = value, { integrityHash, ...body } = op;
    if (op.schemaVersion !== "apn.circle-v2-evm-operation.v1" || hashObject(body) !== integrityHash || ![op.operationId, op.profileHash, op.destinationProfileHash, op.idempotencyHash, op.requestHash, op.fingerprint, op.deploymentDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
        circleCorrupt("integrity");
    const route = circleRoute(op.destinationChain, op.destinationProfile);
    validateEvmNativeCustody(op.sourceCustody);
    validateEvmNativeCustody(op.destinationCustody);
    if (op.profile !== "evm-live-buyer" || op.destinationProfile !== route.gasPayerProfile || op.sourceCustody.walletAddress !== CIRCLE_SOURCE_OWNER || op.destinationCustody.walletAddress !== route.gasPayer ||
        op.profileHash !== sha256(`profile\0${op.profile}`) || op.destinationProfileHash !== sha256(`profile\0${op.destinationProfile}`) || op.profileHash !== op.sourceCustody.profileHash || op.destinationProfileHash !== op.destinationCustody.profileHash || !/^(?:0|[1-9][0-9]*)$/u.test(op.feeQuoteAtomic) || BigInt(op.feeQuoteAtomic) > 100n ||
        !["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required", "completed", "cleaned", "cancelled_unsubmitted", "nonce_retired", "external_fulfilled"].includes(op.state) || op.terminal !== ["completed", "cleaned", "cancelled_unsubmitted", "nonce_retired", "external_fulfilled"].includes(op.state) ||
        !Number.isFinite(Date.parse(op.preparedAt)) || !Number.isFinite(Date.parse(op.expiresAt)) || Date.parse(op.expiresAt) <= Date.parse(op.preparedAt) ||
        !/^(?:0|40100)$/u.test(op.residualAllowanceAtomic) || typeof op.usageFinalized !== "boolean" || !Array.isArray(op.usage) || !Array.isArray(op.policies))
        circleCorrupt("intent");
    if (op.policies.length !== new Set([op.profileHash, op.destinationProfileHash]).size || new Set(op.policies.map(p => p.profileHash)).size !== op.policies.length)
        circleCorrupt("policy_count");
    for (const p of op.policies)
        if (!shape(p, ["profile", "profileHash", "policyDigest", "revision", ...(p.activationDigest === undefined ? [] : ["activationDigest"])]) || ![op.profile, op.destinationProfile].includes(p.profile) || ![op.profileHash, op.destinationProfileHash].includes(p.profileHash) || !/^[a-f0-9]{64}$/u.test(p.policyDigest) || !Number.isSafeInteger(p.revision) || p.revision < 1 || p.activationDigest !== undefined && !/^[a-f0-9]{64}$/u.test(p.activationDigest))
            circleCorrupt("policy_binding");
    if (op.usage.length > 5 || op.state !== "cancelled_unsubmitted" && ![0, 5].includes(op.usage.length))
        circleCorrupt("usage_count");
    for (const u of op.usage)
        validateAssetUsageReservation(u);
    const expectedUsage = [
        { account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, amount: "40100" },
        { account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", kind: "native", identifier: null, amount: "30000000000000" },
        { account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", kind: "native", identifier: null, amount: "30000000000000" },
        { account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", kind: "native", identifier: null, amount: "15000000000000" },
        { account: route.gasPayer, chain: `eip155:${op.destinationChain}`, kind: "native", identifier: null, amount: route.destinationNativeCap }
    ];
    for (const [i, u] of op.usage.entries()) {
        const expected = expectedUsage[i];
        if (u.account !== expected.account || u.chain !== expected.chain || u.asset.kind !== expected.kind || u.asset.identifier !== expected.identifier || u.amountAtomic !== expected.amount || u.rail !== "bridge" || !op.policies.some(p => p.policyDigest === u.policyDigest))
            circleCorrupt("usage_binding");
    }
    if (op.usageFinalized && op.state !== "external_fulfilled" && (op.state === "cancelled_unsubmitted" ? op.usage.some(u => u.state !== "failed_before_effect") : op.usage.length !== 5 || op.usage.some(u => !["finalized", "failed_confirmed_revert"].includes(u.state))))
        circleCorrupt("usage_finality");
    if (new Set(op.usage.map(u => u.reservationId)).size !== op.usage.length)
        circleCorrupt("duplicate_usage");
    if (!Array.isArray(op.effects) || op.effects.length < 2 || op.effects.length > 4 || op.effects[0]?.role !== "approval" || op.effects[1]?.role !== "burn" || new Set(op.effects.map(x => x.role)).size !== op.effects.length)
        circleCorrupt("effects");
    for (const inputEffect of op.effects) {
        const e = inputEffect;
        if (!shape(e, ["role", "phase", "envelope", "transactionHash", "materialHash", "proof"]) || !["approval", "burn", "mint", "cleanup"].includes(e.role) || !["prepared", "signing_started", "sealed", "submission_started", "submitted", "unknown", "confirmed", "reverted"].includes(e.phase))
            circleCorrupt("effect_shape");
        validateCircleEnvelope(e.envelope, e.role, op.destinationChain, op.attestation, op.destinationProfile);
        if ((e.transactionHash !== null && !/^0x[a-f0-9]{64}$/u.test(e.transactionHash)) || (e.materialHash !== null && !/^[a-f0-9]{64}$/u.test(e.materialHash)) ||
            (["sealed", "submission_started", "submitted", "confirmed", "reverted"].includes(e.phase) && (e.materialHash === null || e.transactionHash === null)) ||
            (["confirmed", "reverted"].includes(e.phase) && (e.proof === null || e.proof.transactionHash !== e.transactionHash)))
            circleCorrupt("effect_material");
        if (e.phase === "reverted" && (e.proof?.finalityTag !== "finalized" || e.role === "mint"))
            circleCorrupt("revert_finality");
    }
    if (BigInt(op.effects[1].envelope.nonceAtomic) !== BigInt(op.effects[0].envelope.nonceAtomic) + 1n)
        circleCorrupt("source_nonce_order");
    if (op.source !== null) {
        assertCircleSource(op.source);
        if (op.source.destinationChain !== op.destinationChain || op.source.transactionHash !== op.effects[1].transactionHash)
            circleCorrupt("source_binding");
    }
    if (op.attestation !== null) {
        if (op.source === null)
            circleCorrupt("attestation_without_source");
        assertCircleAttestation(op.source, op.attestation);
    }
    if (op.destination !== null && (op.attestation === null || op.destination.nonce !== op.attestation.nonce || op.destination.attestedMessageHash !== op.attestation.hash || op.destination.transactionHash !== op.effects.find(e => e.role === "mint")?.transactionHash))
        circleCorrupt("destination_binding");
    if (op.state === "completed" && (op.source?.finalityTag !== "finalized" || op.destination?.finalityTag !== "safe" || op.residualAllowanceAtomic !== "0" || !op.usageFinalized))
        circleCorrupt("completion_finality");
    if (op.state === "cancelled_unsubmitted" && (op.source !== null || op.attestation !== null || op.destination !== null || op.residualAllowanceAtomic !== "0" || !op.usageFinalized || op.effects.some(e => e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null)))
        circleCorrupt("cancel_private_entry");
    if (op.externalFulfillment !== undefined) {
        validateExternalFulfillment(op.externalFulfillment, op);
        if (op.effects.some(e => ["mint", "cleanup"].includes(e.role) && (e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null)) || op.destination !== null || op.source?.finalityTag !== "finalized" || op.residualAllowanceAtomic !== "0" || op.nonceRetirement !== undefined)
            circleCorrupt("external_private_or_source_binding");
    }
    if (op.state === "external_fulfilled" && (op.externalFulfillment === undefined || !op.usageFinalized || op.usage.length !== 5 || op.usage.some((u, i) => u.state !== (i < 3 ? "finalized" : "released_unsubmitted"))))
        circleCorrupt("external_terminal_binding");
    if (op.nonceRetirement !== undefined)
        validateCircleNonceRetirementProof(op.nonceRetirement, op);
    if (op.state === "nonce_retired" && (op.nonceRetirement === undefined || op.source !== null || op.residualAllowanceAtomic !== "0" || !op.usageFinalized))
        circleCorrupt("nonce_retirement_terminal");
    if (op.state !== "nonce_retired" && op.nonceRetirement !== undefined)
        circleCorrupt("nonce_retirement_metadata_state");
    if (op.state === "cleaned" && (op.residualAllowanceAtomic !== "0" || op.source !== null || !op.usageFinalized))
        circleCorrupt("cleanup_completion");
    if (!Array.isArray(op.transitions) || op.transitions.length < 1 || op.transitions.length > 500)
        circleCorrupt("transitions");
    for (const [i, t] of op.transitions.entries())
        if (!shape(t, ["sequence", "at", "reason", "previousHash", "snapshotHash"]) || t.sequence !== i || t.previousHash !== (i === 0 ? null : op.transitions[i - 1].snapshotHash) || !/^[a-f0-9]{64}$/u.test(t.snapshotHash) || !Number.isFinite(Date.parse(t.at)) || i > 0 && t.at < op.transitions[i - 1].at)
            circleCorrupt("transition_chain");
    const { integrityHash: _hash, transitions: _transitions, ...snapshot } = op;
    if (op.transitions.at(-1).snapshotHash !== hashObject(snapshot))
        circleCorrupt("snapshot_binding");
    return op;
}
export function publicCircle(op) {
    return { operation_id: op.operationId, kind: "circle_route", state: op.state, terminal: op.terminal,
        source_profile: op.profile, destination_profile: op.destinationProfile, destination_chain: op.destinationChain, amount_atomic: "40100", minimum_output_atomic: "40000",
        effects: op.effects.map(e => ({ role: e.role, phase: e.phase, transaction_hash: e.transactionHash, actual_fee_atomic: e.proof?.actualFeeAtomic ?? null })),
        source_finality: op.source?.finalityTag ?? null, destination_finality: op.destination?.finalityTag ?? op.externalFulfillment?.destinationReceipt.finalityTag ?? null, nonce: op.attestation?.nonce ?? null,
        residual_allowance_atomic: op.residualAllowanceAtomic, usage_finalized: op.usageFinalized, integrity_hash: op.integrityHash, ...(op.nonceRetirement === undefined ? {} : { cleanup_retirement_receipt: op.nonceRetirement }),
        ...(op.externalFulfillment === undefined ? {} : { external_fulfillment: op.externalFulfillment, proof_class: "circle_external_mint_fulfillment", destination_finality_external: "safe", controlled_destination_native_atomic: "0", source_budget_native_atomic: "60000000000000", source_actual_native_atomic: (BigInt(op.externalFulfillment.sourceApprovalActualFeeAtomic) + BigInt(op.externalFulfillment.sourceBurnActualFeeAtomic)).toString(), destination_fee_payer: op.externalFulfillment.caller }),
        next_actions: op.terminal ? [] : [`apn circle evm observe --operation ${op.operationId}`] };
}
export function circleSame(a, b) { return canonicalJson(a) === canonicalJson(b); }
function shape(value, keys) { return isPlainRecord(value) && exactKeys(value, keys); }
//# sourceMappingURL=operation-model.js.map