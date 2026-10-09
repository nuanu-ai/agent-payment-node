import { canonicalJson, hashObject } from "../canonical.js";
import { requireMerchantCanonicalReceipt } from "./rpc.js";
import { validateMerchant } from "./model.js";
import { refuse } from "./protocol.js";
export function merchantNativeActualFee(o, r) {
    validateMerchant(o);
    const freshHash = requireMerchantCanonicalReceipt(o, r), saved = o.receipt, audit = o.canonicalObservations?.at(-1);
    if (saved === null || audit?.result !== "verified" || audit.currentReceiptHash !== freshHash || audit.priorReceiptHash !== hashObject(saved) || canonicalJson(audit.currentAnchors) !== canonicalJson(r.canonical) || ["transactionHash", "blockNumber", "blockHash", "status", "networkFeeWei"].some(k => saved[k] !== r[k]) || canonicalJson(saved.fullFee) !== canonicalJson(r.fullFee) || saved.canonical?.transactionIndex !== r.canonical?.transactionIndex || saved.canonical?.blockHeaderHash !== r.canonical?.blockHeaderHash)
        refuse("merchant_native_actual_fee_fresh_audit_required");
    const receiptHash = hashObject(saved);
    if (o.signingAttempts !== 1 || o.submissionAttempts !== 1 || o.txHash === null || o.txHash !== r.transactionHash || r.status !== "success" || o.envelope.nativeFeeReserveWei === undefined || o.effectBinding?.nativeAmountAtomic !== o.envelope.nativeFeeReserveWei || r.fullFee === undefined || r.canonical === undefined || BigInt(r.networkFeeWei) > BigInt(o.envelope.nativeFeeReserveWei))
        refuse("merchant_native_actual_fee_authority_required");
    return { kind: "merchant_mega_native_actual_fee", operationId: o.operationId, fingerprint: o.fingerprint, receiptHash, actualFee: r.networkFeeWei, reservedFee: o.envelope.nativeFeeReserveWei };
}
//# sourceMappingURL=fee-settlement.js.map