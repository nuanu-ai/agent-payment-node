import { getAddress, keccak256, serializeTransaction, recoverTransactionAddress } from "viem";
import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { CIRCLE_SOURCE_OWNER } from "./catalog.js";
import { circleBlocked } from "./operation-model.js";
import { circleHex, circleUint, circleRecord } from "./protocol.js";
/** Reconstructs public finalized wire only. Never loads any stored private material. */
export async function verifyCleanup85PublicWire(input, envelope, expectedHash, noLogs = false) {
    const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock), check = circleRecord(input.recheckedBlock), head = circleRecord(input.finalityHead);
    const hash = circleHex(expectedHash, 32), block = circleHex(r.blockHash, 32), number = circleUint(r.blockNumber), time = circleUint(b.timestamp), index = circleUint(r.transactionIndex), zero = "0x" + "0".repeat(64);
    if (input.chainId !== 42161 || input.finalityTag !== "finalized" || circleUint(t.type) !== 2n || circleUint(t.chainId) !== 42161n || getAddress(String(t.from)) !== CIRCLE_SOURCE_OWNER || getAddress(String(t.to)) !== envelope.to ||
        circleHex(t.hash, 32) !== hash || circleUint(t.nonce).toString() !== envelope.nonceAtomic || circleUint(t.value).toString() !== envelope.valueAtomic || circleHex(t.input) !== envelope.data ||
        circleUint(t.gas).toString() !== envelope.gasLimitAtomic || circleUint(t.maxFeePerGas).toString() !== envelope.maxFeePerGasAtomic || circleUint(t.maxPriorityFeePerGas).toString() !== envelope.maxPriorityFeePerGasAtomic ||
        !Array.isArray(t.accessList) || t.accessList.length !== 0 || Object.hasOwn(t, "authorizationList") && (!Array.isArray(t.authorizationList) || t.authorizationList.length !== 0) ||
        circleHex(r.transactionHash, 32) !== hash || circleUint(r.status) !== 1n || getAddress(String(r.from)) !== envelope.from || getAddress(String(r.to)) !== envelope.to || circleHex(t.blockHash, 32) !== block || circleUint(t.blockNumber) !== number || circleUint(t.transactionIndex) !== index ||
        block === zero || time === 0n || circleHex(b.hash, 32) !== block || circleUint(b.number) !== number || circleHex(check.hash, 32) !== block || circleUint(check.number) !== number || circleUint(check.timestamp) !== time ||
        !Array.isArray(b.transactions) || b.transactions[Number(index)] !== hash || b.transactions.filter(x => x === hash).length !== 1 || circleHex(head.hash, 32) === zero || circleUint(head.number) < number || circleUint(head.timestamp) < time || noLogs && (!Array.isArray(r.logs) || r.logs.length !== 0))
        circleBlocked("cleanup85_exact_finalized_wire_required");
    const raw = serializeTransaction({ type: "eip1559", chainId: 42161, nonce: Number(circleUint(t.nonce)), to: getAddress(String(t.to)), data: circleHex(t.input), value: circleUint(t.value), gas: circleUint(t.gas), maxFeePerGas: circleUint(t.maxFeePerGas), maxPriorityFeePerGas: circleUint(t.maxPriorityFeePerGas), accessList: [] }, { r: circleHex(t.r, 32), s: circleHex(t.s, 32), yParity: Number(circleUint(t.yParity ?? t.v)) });
    if (keccak256(raw) !== hash || getAddress(await recoverTransactionAddress({ serializedTransaction: raw })) !== CIRCLE_SOURCE_OWNER)
        circleBlocked("cleanup85_public_signature_changed");
    return raw;
}
export async function cleanup85Reanchor(source, observation) {
    for (const value of [observation.canonicalBlock, observation.finalityHead]) {
        const old = circleRecord(value), fresh = await source.block(String(old.number));
        if (circleHex(fresh.hash, 32) !== circleHex(old.hash, 32) || circleUint(fresh.number) !== circleUint(old.number) || circleUint(fresh.timestamp) !== circleUint(old.timestamp))
            circleBlocked("cleanup85_canonical_reanchor_changed");
    }
}
export function assertCancellationProofShape(proof) {
    if (!isPlainRecord(proof) || !exactKeys(proof, ["version", "requestBinding", "operationId", "fingerprint", "materialHash", "transactionHash", "envelope", "sourceCustody", "recipientCustody", "observation", "actualFeeAtomic", "nativeReservationId", "nativeOutcomeDigest", "nativeConsumedAtomic", "proofHash"]) || !isPlainRecord(proof.envelope) || !exactKeys(proof.envelope, ["chainId", "from", "to", "nonceAtomic", "valueAtomic", "data", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"]) ||
        ![proof.requestBinding, proof.operationId, proof.fingerprint, proof.materialHash, proof.nativeReservationId, proof.nativeOutcomeDigest, proof.proofHash, proof.envelope.envelopeHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) ||
        ![proof.actualFeeAtomic, proof.nativeConsumedAtomic, proof.envelope.gasLimitAtomic, proof.envelope.maxFeePerGasAtomic, proof.envelope.maxPriorityFeePerGasAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]*)$/u.test(x)) || !isPlainRecord(proof.observation) || !exactKeys(proof.observation, ["transaction", "receipt", "canonicalBlock", "recheckedBlock", "finalityHead", "chainId", "finalityTag"]))
        circleBlocked("cleanup85_cancellation_proof_shape");
    const { proofHash, ...body } = proof, e = proof.envelope;
    const { envelopeHash, ...envelopeBody } = e;
    if (proof.version !== "apn.circle-cleanup85-native-cancellation-proof.v1" || hashObject(body) !== proofHash || e.chainId !== 42161 || e.from !== CIRCLE_SOURCE_OWNER || e.to !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || e.nonceAtomic !== "85" || e.valueAtomic !== "1" || e.data !== "0x" ||
        hashObject(envelopeBody) !== envelopeHash || BigInt(e.gasLimitAtomic) < 21000n || BigInt(e.maxFeePerGasAtomic) < 45000000n || BigInt(e.maxPriorityFeePerGasAtomic) < 1n || BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic) || BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n > 2000000000000n || BigInt(proof.nativeConsumedAtomic) !== BigInt(proof.actualFeeAtomic) + 1n || BigInt(proof.nativeConsumedAtomic) > BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n)
        circleBlocked("cleanup85_cancellation_proof_binding");
    validateEvmNativeCustody(proof.sourceCustody);
    validateEvmNativeCustody(proof.recipientCustody);
    if (proof.sourceCustody.walletAddress !== e.from || proof.recipientCustody.walletAddress !== e.to)
        circleBlocked("cleanup85_cancellation_custody_changed");
}
export async function verifyCancellationPublic(source, proof) {
    assertCancellationProofShape(proof);
    const e = proof.envelope;
    await verifyCleanup85PublicWire(proof.observation, e, proof.transactionHash, true);
    await cleanup85Reanchor(source, proof.observation);
    const observation = await source.observation(circleHex(proof.transactionHash, 32), "finalized");
    if (observation === null)
        circleBlocked("cleanup85_cancellation_not_finalized");
    await verifyCleanup85PublicWire(observation, e, proof.transactionHash, true);
    const r = circleRecord(observation.receipt);
    if (circleUint(r.gasUsed) > BigInt(e.gasLimitAtomic) || circleUint(r.effectiveGasPrice) > BigInt(e.maxFeePerGasAtomic) || (circleUint(r.gasUsed) * circleUint(r.effectiveGasPrice)).toString() !== proof.actualFeeAtomic || hashObject(observation.receipt) !== hashObject(proof.observation.receipt) || hashObject(observation.transaction) !== hashObject(proof.observation.transaction) || circleHex(circleRecord(observation.canonicalBlock).hash, 32) !== circleHex(circleRecord(proof.observation.canonicalBlock).hash, 32))
        circleBlocked("cleanup85_cancellation_receipt_changed");
    for (const field of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"])
        if (r[field] !== undefined && circleUint(r[field]) !== 0n)
            circleBlocked("cleanup85_unmodeled_native_fee");
    await cleanup85Reanchor(source, observation);
    return observation;
}
//# sourceMappingURL=cleanup85-public-proof.js.map