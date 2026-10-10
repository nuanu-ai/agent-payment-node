import { decodeCircleMintEvents } from "./mint-events.js";
import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction, toRlp } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { CIRCLE_AMOUNT, CIRCLE_MESSENGER, CIRCLE_MIN_MINT, CIRCLE_RECIPIENT, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { assertCircleAttestation, assertCircleSource, circleFail, circleHex, circleRecord, circleUint, circleWord, encodeCircleMint, oneEvent } from "./protocol.js";
const HEADER_BYTES = ["parentHash", "sha3Uncles", "miner", "stateRoot", "transactionsRoot", "receiptsRoot", "logsBloom"];
const HEADER_QUANTITIES = ["difficulty", "number", "gasLimit", "gasUsed", "timestamp"];
function rlpQuantity(v) { const n = circleUint(v); if (n === 0n)
    return "0x"; const h = n.toString(16); return `0x${h.padStart(Math.ceil(h.length / 2) * 2, "0")}`; }
/** Recompute the actual Ethereum-compatible RLP header, including contiguous fork suffixes. */
export function circleExternalHeader(value) {
    const b = circleRecord(value), fields = HEADER_BYTES.map(k => circleHex(b[k], k === "miner" ? 20 : k === "logsBloom" ? 256 : 32));
    fields.push(...HEADER_QUANTITIES.map(k => rlpQuantity(b[k])), circleHex(b.extraData), circleHex(b.mixHash, 32), circleHex(b.nonce, 8));
    if (String(b.extraData).length > 514 || circleUint(b.gasUsed) > circleUint(b.gasLimit))
        circleFail("external_header_bounds");
    const suffix = ["baseFeePerGas", "withdrawalsRoot", "blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot", "requestsHash"];
    let absent = false;
    for (const k of suffix) {
        if (b[k] === undefined) {
            absent = true;
            continue;
        }
        if (absent)
            circleFail("external_header_fork_gap");
        fields.push(["baseFeePerGas", "blobGasUsed", "excessBlobGas"].includes(k) ? rlpQuantity(b[k]) : circleHex(b[k], 32));
    }
    const hash = keccak256(toRlp(fields));
    if (hash !== circleHex(b.hash, 32))
        circleFail("external_header_hash");
    return hash;
}
export async function circleExternalTransaction(value) {
    const t = circleRecord(value), chainId = Number(circleUint(t.chainId)), nonce = Number(circleUint(t.nonce)), type = circleUint(t.type);
    if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(nonce))
        circleFail("external_transaction_quantity");
    const common = { chainId, nonce, gas: circleUint(t.gas), to: getAddress(String(t.to)), value: circleUint(t.value), data: circleHex(t.input) };
    const signatureScalar = (value) => { if (typeof value !== "string" || !/^0x[a-fA-F0-9]{1,64}$/u.test(value))
        circleFail("external_signature_noncanonical"); const n = BigInt(value); if (n >= 1n << 256n)
        circleFail("external_signature_noncanonical"); return `0x${n.toString(16).padStart(64, "0")}`; };
    const signature = { r: signatureScalar(t.r), s: signatureScalar(t.s), v: circleUint(t.v) };
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    if (BigInt(signature.r) <= 0n || BigInt(signature.r) >= order || BigInt(signature.s) <= 0n || BigInt(signature.s) > order / 2n)
        circleFail("external_signature_noncanonical");
    if (type === 0n && signature.v !== BigInt(chainId) * 2n + 35n && signature.v !== BigInt(chainId) * 2n + 36n || type === 2n && signature.v !== 0n && signature.v !== 1n)
        circleFail("external_signature_chain_parity");
    let raw, feePrice;
    if (type === 0n) {
        feePrice = circleUint(t.gasPrice);
        raw = serializeTransaction({ ...common, type: "legacy", gasPrice: feePrice }, signature);
    }
    else if (type === 2n) {
        if (!Array.isArray(t.accessList) || t.accessList.length !== 0)
            circleFail("external_access_list");
        feePrice = circleUint(t.maxFeePerGas);
        raw = serializeTransaction({ ...common, type: "eip1559", accessList: [], maxFeePerGas: feePrice,
            maxPriorityFeePerGas: circleUint(t.maxPriorityFeePerGas) }, signature);
    }
    else
        circleFail("external_transaction_type");
    const hash = keccak256(raw), caller = await recoverTransactionAddress({ serializedTransaction: raw });
    if (hash !== circleHex(t.hash, 32) || caller !== getAddress(String(t.from)))
        circleFail("external_transaction_hash_or_signer");
    return { hash, caller, feePrice };
}
export async function decodeCircleExternalDestination(op, input, usedNonce, feeRecipient) {
    if (op.source === null || op.attestation === null)
        circleFail("external_source_attestation_required");
    assertCircleAttestation(op.source, op.attestation);
    const route = circleRoute(op.destinationChain, op.destinationProfile), a = op.attestation;
    const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock), h = circleRecord(input.finalityHead);
    const signed = await circleExternalTransaction(t), blockHash = circleExternalHeader(b);
    circleExternalHeader(input.recheckedBlock);
    circleExternalHeader(h);
    const number = circleUint(b.number), index = circleUint(t.transactionIndex), gas = circleUint(t.gas), used = circleUint(r.gasUsed), price = circleUint(r.effectiveGasPrice);
    if (input.chainId !== route.chainId || input.finalityTag !== "safe" || circleUint(t.chainId) !== BigInt(route.chainId) || signed.caller === route.gasPayer ||
        getAddress(String(t.to)) !== CIRCLE_TRANSMITTER || circleHex(t.input) !== encodeCircleMint(a) || circleUint(t.value) !== 0n ||
        circleHex(t.blockHash, 32) !== blockHash || circleUint(t.blockNumber) !== number || circleHex(r.transactionHash, 32) !== signed.hash ||
        circleUint(r.transactionIndex) !== index || circleHex(r.blockHash, 32) !== blockHash || circleUint(r.blockNumber) !== number || circleUint(r.status) !== 1n ||
        getAddress(String(r.from)) !== signed.caller || getAddress(String(r.to)) !== CIRCLE_TRANSMITTER || circleHex(circleRecord(input.recheckedBlock).hash, 32) !== blockHash ||
        circleUint(h.number) < number || !Array.isArray(b.transactions) || b.transactions[Number(index)] !== signed.hash ||
        b.transactions.filter(v => v === signed.hash).length !== 1 || gas === 0n || gas > circleUint(b.gasLimit) || used > gas || price > signed.feePrice)
        circleFail("external_receipt_binding");
    for (const k of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"])
        if (r[k] !== undefined && circleUint(r[k]) !== 0n)
            circleFail("external_unmodeled_fee");
    if (!Array.isArray(r.logs) || r.logs.length > 64)
        circleFail("external_logs_shape");
    const seen = new Set();
    for (const value of r.logs) {
        const l = circleRecord(value), key = circleUint(l.logIndex).toString();
        if (seen.has(key) || l.removed !== false || circleHex(l.transactionHash, 32) !== signed.hash || circleHex(l.blockHash, 32) !== blockHash ||
            circleUint(l.blockNumber) !== number || circleUint(l.transactionIndex) !== index)
            circleFail("external_log_membership");
        seen.add(key);
    }
    decodeCircleMintEvents(a, input, feeRecipient);
    const received = oneEvent(input, "MessageReceived", CIRCLE_TRANSMITTER).args;
    if (circleUint(String(usedNonce)) !== 1n || getAddress(String(received.caller)) !== signed.caller || received.sourceDomain !== 3 ||
        circleHex(received.nonce, 32) !== a.nonce || circleHex(received.sender, 32) !== circleWord(CIRCLE_MESSENGER) ||
        received.finalityThresholdExecuted !== a.finalityExecuted || circleHex(received.messageBody) !== a.body ||
        BigInt(a.expirationBlock) !== 0n && BigInt(a.expirationBlock) <= number || CIRCLE_AMOUNT - BigInt(a.feeExecutedAtomic) !== BigInt(a.receivedAtomic) || BigInt(a.receivedAtomic) < CIRCLE_MIN_MINT)
        circleFail("external_message_binding");
    return { caller: signed.caller, transactionHash: signed.hash, blockHash, blockNumberAtomic: number.toString(), finalityBlockHash: circleHex(h.hash, 32), finalityBlockNumberAtomic: circleUint(h.number).toString(),
        transactionHashBinding: hashObject(t), finalityTag: "safe", receiptHash: hashObject(r), logsHash: hashObject(r.logs), actualFeeAtomic: ((route.chainId === 143 ? gas : used) * price).toString() };
}
export function externalClaimKey(op) {
    if (op.attestation === null || op.source === null)
        circleFail("external_claim_source");
    return hashObject({ chain: op.destinationChain, transmitter: CIRCLE_TRANSMITTER, nonce: op.attestation.nonce });
}
export function validateExternalFulfillment(p, op) {
    if (!isPlainRecord(p) || !exactKeys(p, ["schemaVersion", "operationId", "fingerprint", "sourceTransactionHash", "sourceMessageHash", "attestedMessageHash", "nonce", "destinationChain", "recipient", "token", "grossAtomic", "issuerFeeAtomic", "netAtomic", "caller", "controlledDestinationNativeAtomic", "sourceApprovalActualFeeAtomic", "sourceBurnActualFeeAtomic", "destinationReceipt", "sourceFinality", "recipientBalance", "historicalDeploymentDigest", "claimDigest", "evidenceHash", "proofHash"]))
        circleFail("external_proof_shape");
    assertCircleSource(p.sourceFinality);
    const { proofHash, ...body } = p, route = circleRoute(op.destinationChain, op.destinationProfile), balance = p.recipientBalance;
    if (p.schemaVersion !== "apn.circle-external-fulfillment.v1" || proofHash !== hashObject(body) || p.operationId !== op.operationId || p.fingerprint !== op.fingerprint ||
        p.sourceTransactionHash !== op.source?.transactionHash || p.sourceMessageHash !== op.source?.sourceMessageHash || p.attestedMessageHash !== op.attestation?.hash || p.nonce !== op.attestation?.nonce ||
        p.destinationChain !== op.destinationChain || p.recipient !== CIRCLE_RECIPIENT || p.token !== route.token || p.grossAtomic !== "40100" || p.issuerFeeAtomic !== op.attestation?.feeExecutedAtomic || p.netAtomic !== op.attestation?.receivedAtomic ||
        p.controlledDestinationNativeAtomic !== "0" || getAddress(p.caller) !== p.caller || p.caller === route.gasPayer || p.sourceFinality.finalityTag !== "finalized" || p.destinationReceipt.finalityTag !== "safe" ||
        p.sourceFinality.sourceMessageHash !== p.sourceMessageHash || p.sourceFinality.transactionHash !== p.sourceTransactionHash ||
        p.sourceApprovalActualFeeAtomic !== op.effects[0]?.proof?.actualFeeAtomic || p.sourceBurnActualFeeAtomic !== p.sourceFinality.actualFeeAtomic ||
        ![p.historicalDeploymentDigest, p.claimDigest, p.evidenceHash].every(x => /^[a-f0-9]{64}$/u.test(x)) ||
        !isPlainRecord(balance) || !exactKeys(balance, ["parentHash", "parentNumberAtomic", "before", "after", "delta"]) || circleUint(balance.after) - circleUint(balance.before) !== BigInt(p.netAtomic) || balance.delta !== p.netAtomic ||
        circleUint(balance.parentNumberAtomic) + 1n !== BigInt(p.destinationReceipt.blockNumberAtomic))
        circleFail("external_proof_binding");
    circleHex(balance.parentHash, 32);
    const receipt = p.destinationReceipt;
    if (!isPlainRecord(receipt) || !exactKeys(receipt, ["transactionHash", "blockHash", "blockNumberAtomic", "finalityBlockHash", "finalityBlockNumberAtomic", "transactionHashBinding", "finalityTag", "receiptHash", "logsHash", "actualFeeAtomic"]) ||
        ![receipt.transactionHashBinding, receipt.receiptHash, receipt.logsHash].every(x => /^[a-f0-9]{64}$/u.test(x)) || circleUint(receipt.finalityBlockNumberAtomic) < circleUint(receipt.blockNumberAtomic))
        circleFail("external_receipt_proof_shape");
    for (const x of [receipt.transactionHash, receipt.blockHash, receipt.finalityBlockHash])
        circleHex(x, 32);
    for (const x of [receipt.actualFeeAtomic, p.sourceApprovalActualFeeAtomic, p.sourceBurnActualFeeAtomic])
        circleUint(x);
    if (p.claimDigest !== externalClaimKey(op))
        circleFail("external_claim_digest");
}
//# sourceMappingURL=external-proof.js.map