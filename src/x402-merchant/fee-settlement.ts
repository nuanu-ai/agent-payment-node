import { canonicalJson,hashObject } from "../canonical.js";
import { requireMerchantCanonicalReceipt } from "./rpc.js";
import { validateMerchant, type MerchantOperation, type MerchantReceipt } from "./model.js";
import { refuse } from "./protocol.js";
export interface MerchantNativeActualFee {
 readonly kind:"merchant_mega_native_actual_fee";readonly operationId:string;readonly fingerprint:string;readonly receiptHash:string;readonly actualFee:string;readonly reservedFee:string;
}
export function merchantNativeActualFee(o:MerchantOperation,r:MerchantReceipt):MerchantNativeActualFee {
 validateMerchant(o);const freshHash=requireMerchantCanonicalReceipt(o,r),saved=o.receipt,audit=o.canonicalObservations?.at(-1);
 if(saved===null||audit?.result!=="verified"||audit.currentReceiptHash!==freshHash||audit.priorReceiptHash!==hashObject(saved)||canonicalJson(audit.currentAnchors)!==canonicalJson(r.canonical)||["transactionHash","blockNumber","blockHash","status","networkFeeWei"].some(k=>saved[k as keyof MerchantReceipt]!==r[k as keyof MerchantReceipt])||canonicalJson(saved.fullFee)!==canonicalJson(r.fullFee)||saved.canonical?.transactionIndex!==r.canonical?.transactionIndex||saved.canonical?.blockHeaderHash!==r.canonical?.blockHeaderHash)refuse("merchant_native_actual_fee_fresh_audit_required");
 const receiptHash=hashObject(saved);if(o.signingAttempts!==1||o.submissionAttempts!==1||o.txHash===null||o.txHash!==r.transactionHash||r.status!=="success"||o.envelope.nativeFeeReserveWei===undefined||o.effectBinding?.nativeAmountAtomic!==o.envelope.nativeFeeReserveWei||r.fullFee===undefined||r.canonical===undefined||BigInt(r.networkFeeWei)>BigInt(o.envelope.nativeFeeReserveWei))refuse("merchant_native_actual_fee_authority_required");
 return {kind:"merchant_mega_native_actual_fee",operationId:o.operationId,fingerprint:o.fingerprint,receiptHash,actualFee:r.networkFeeWei,reservedFee:o.envelope.nativeFeeReserveWei};
}
