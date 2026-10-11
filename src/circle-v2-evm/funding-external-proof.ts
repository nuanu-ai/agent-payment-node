import { decodeCircleMintEvents } from "./mint-events.js";
import { getAddress, type Address } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { assertCircleAttestation, assertCircleSource, circleFail, circleHex, circleRecord, circleUint, circleWord, encodeCircleMint, oneEvent, type CircleObservation, type CircleReceiptProof } from "./protocol.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";
import { circleExternalHeader, circleExternalTransaction, type CircleExternalFulfillment } from "./external-proof.js";
export interface CircleFundingExternalFulfillment extends Omit<CircleExternalFulfillment, "schemaVersion" | "grossAtomic" | "recipientBalance"> {
 readonly schemaVersion: "apn.circle-funding-external-fulfillment.v2"; readonly grossAtomic: string;
 readonly recipientCredit: { readonly transactionHash: string; readonly blockHash: string; readonly logIndexAtomic: string; readonly amountAtomic: string; readonly logHash: string };
}
export async function decodeCircleFundingExternalDestination(op: CircleFundingOperationV2, input: CircleObservation, usedNonce: unknown, feeRecipient?: Address): Promise<CircleReceiptProof & { caller: Address }> {
  if (op.source === null || op.attestation === null) circleFail("external_source_attestation_required");
  assertCircleAttestation(op.source, op.attestation, op.funding); const route = circleRoute(op.destinationChain, op.destinationProfile), a = op.attestation;
  const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock), h = circleRecord(input.finalityHead);
  const signed = await circleExternalTransaction(t), blockHash = circleExternalHeader(b); circleExternalHeader(input.recheckedBlock); circleExternalHeader(h);
  const number = circleUint(b.number), index = circleUint(t.transactionIndex), gas = circleUint(t.gas), used = circleUint(r.gasUsed), price = circleUint(r.effectiveGasPrice);
  if (input.chainId !== route.chainId || input.finalityTag !== "safe" || circleUint(t.chainId) !== BigInt(route.chainId) || signed.caller === route.gasPayer ||
    getAddress(String(t.to)) !== CIRCLE_TRANSMITTER || circleHex(t.input) !== encodeCircleMint(a) || circleUint(t.value) !== 0n ||
    circleHex(t.blockHash,32) !== blockHash || circleUint(t.blockNumber) !== number || circleHex(r.transactionHash,32) !== signed.hash ||
    circleUint(r.transactionIndex) !== index || circleHex(r.blockHash,32) !== blockHash || circleUint(r.blockNumber) !== number || circleUint(r.status) !== 1n ||
    getAddress(String(r.from)) !== signed.caller || getAddress(String(r.to)) !== CIRCLE_TRANSMITTER || circleHex(circleRecord(input.recheckedBlock).hash,32) !== blockHash ||
    circleUint(h.number) < number || !Array.isArray(b.transactions) || b.transactions[Number(index)] !== signed.hash ||
    b.transactions.filter(v => v === signed.hash).length !== 1 || gas === 0n || gas > circleUint(b.gasLimit) || used > gas || price > signed.feePrice) circleFail("external_receipt_binding");
  for (const k of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"]) if (r[k] !== undefined && circleUint(r[k]) !== 0n) circleFail("external_unmodeled_fee");
  if (!Array.isArray(r.logs) || r.logs.length > 64) circleFail("external_logs_shape"); const seen = new Set<string>();
  for (const value of r.logs) { const l = circleRecord(value), key = circleUint(l.logIndex).toString();
    if (seen.has(key) || l.removed !== false || circleHex(l.transactionHash,32) !== signed.hash || circleHex(l.blockHash,32) !== blockHash ||
      circleUint(l.blockNumber) !== number || circleUint(l.transactionIndex) !== index) circleFail("external_log_membership"); seen.add(key); }
  decodeCircleMintEvents(a,input,feeRecipient,op.funding);
  const received = oneEvent(input,"MessageReceived",CIRCLE_TRANSMITTER).args;
  if (circleUint(String(usedNonce)) !== 1n || getAddress(String(received.caller)) !== signed.caller || received.sourceDomain !== 3 ||
    circleHex(received.nonce,32) !== a.nonce || circleHex(received.sender,32) !== circleWord(CIRCLE_MESSENGER) ||
    received.finalityThresholdExecuted !== a.finalityExecuted || circleHex(received.messageBody) !== a.body ||
    BigInt(a.expirationBlock) !== 0n && BigInt(a.expirationBlock) <= number || BigInt(op.funding.amountAtomic) - BigInt(a.feeExecutedAtomic) !== BigInt(a.receivedAtomic) || BigInt(a.receivedAtomic) < BigInt(op.funding.minMintAtomic)) circleFail("external_message_binding");
  return { caller:signed.caller,transactionHash:signed.hash,blockHash,blockNumberAtomic:number.toString(),finalityBlockHash:circleHex(h.hash,32),finalityBlockNumberAtomic:circleUint(h.number).toString(),
    transactionHashBinding:hashObject(t),finalityTag:"safe",receiptHash:hashObject(r),logsHash:hashObject(r.logs),actualFeeAtomic:((route.chainId === 143 ? gas : used)*price).toString() };
}
export function fundingExternalClaimKey(op: CircleFundingOperationV2): string {
  if (op.attestation === null || op.source === null) circleFail("external_claim_source");
  return hashObject({ chain:op.destinationChain,transmitter:CIRCLE_TRANSMITTER,nonce:op.attestation.nonce });
}
export function validateFundingExternalFulfillment(p: CircleFundingExternalFulfillment, op: CircleFundingOperationV2): void {
  if (!isPlainRecord(p) || !exactKeys(p,["schemaVersion","operationId","fingerprint","sourceTransactionHash","sourceMessageHash","attestedMessageHash","nonce","destinationChain","recipient","token","grossAtomic","issuerFeeAtomic","netAtomic","caller","controlledDestinationNativeAtomic","sourceApprovalActualFeeAtomic","sourceBurnActualFeeAtomic","destinationReceipt","sourceFinality","recipientCredit","historicalDeploymentDigest","claimDigest","evidenceHash","proofHash"])) circleFail("external_proof_shape");
  assertCircleSource(p.sourceFinality, op.funding);
  const {proofHash,...body}=p, route=circleRoute(op.destinationChain,op.destinationProfile), credit=p.recipientCredit;
  if (p.schemaVersion !== "apn.circle-funding-external-fulfillment.v2" || proofHash !== hashObject(body) || p.operationId !== op.operationId || p.fingerprint !== op.fingerprint ||
    p.sourceTransactionHash !== op.source?.transactionHash || p.sourceMessageHash !== op.source?.sourceMessageHash || p.attestedMessageHash !== op.attestation?.hash || p.nonce !== op.attestation?.nonce ||
    p.destinationChain !== op.destinationChain || p.recipient !== op.funding.recipient || p.token !== route.token || p.grossAtomic !== op.funding.amountAtomic || p.issuerFeeAtomic !== op.attestation?.feeExecutedAtomic || p.netAtomic !== op.attestation?.receivedAtomic ||
    p.controlledDestinationNativeAtomic !== "0" || getAddress(p.caller) !== p.caller || p.caller === route.gasPayer || p.sourceFinality.finalityTag !== "finalized" || p.destinationReceipt.finalityTag !== "safe" ||
    p.sourceFinality.sourceMessageHash !== p.sourceMessageHash || p.sourceFinality.transactionHash !== p.sourceTransactionHash || p.sourceFinality.blockHash !== op.source?.blockHash || p.sourceFinality.receiptHash !== op.source?.receiptHash ||
    p.sourceApprovalActualFeeAtomic !== op.effects[0]?.proof?.actualFeeAtomic || p.sourceBurnActualFeeAtomic !== p.sourceFinality.actualFeeAtomic ||
    ![p.historicalDeploymentDigest,p.claimDigest,p.evidenceHash].every(x=>/^[a-f0-9]{64}$/u.test(x)) ||
    !isPlainRecord(credit) || !exactKeys(credit,["transactionHash","blockHash","logIndexAtomic","amountAtomic","logHash"]) || credit.amountAtomic !== p.netAtomic ||
    credit.transactionHash !== p.destinationReceipt.transactionHash || credit.blockHash !== p.destinationReceipt.blockHash || !/^[a-f0-9]{64}$/u.test(credit.logHash)) circleFail("external_proof_binding");
  circleUint(credit.logIndexAtomic);
  const receipt=p.destinationReceipt;
  if(!isPlainRecord(receipt)||!exactKeys(receipt,["transactionHash","blockHash","blockNumberAtomic","finalityBlockHash","finalityBlockNumberAtomic","transactionHashBinding","finalityTag","receiptHash","logsHash","actualFeeAtomic"]) ||
    ![receipt.transactionHashBinding,receipt.receiptHash,receipt.logsHash].every(x=>/^[a-f0-9]{64}$/u.test(x)) || circleUint(receipt.finalityBlockNumberAtomic)<circleUint(receipt.blockNumberAtomic))circleFail("external_receipt_proof_shape");
  for(const x of [receipt.transactionHash,receipt.blockHash,receipt.finalityBlockHash])circleHex(x,32);
  for(const x of [receipt.actualFeeAtomic,p.sourceApprovalActualFeeAtomic,p.sourceBurnActualFeeAtomic])circleUint(x);
  if(p.claimDigest!==fundingExternalClaimKey(op))circleFail("external_claim_digest");
}

/** Both full proofs are validated before comparing identity. Only advancing finality witnesses and their
 * derived digests are excluded; included transactions, receipts, events, economics and pins stay exact. */
export function fundingExternalStableIdentity(p:CircleFundingExternalFulfillment):unknown {
 const {proofHash:_proof,evidenceHash:_evidence,sourceFinality,destinationReceipt,...identity}=p;
 const {finalityBlockHash:_sourceHead,finalityBlockNumberAtomic:_sourceHeight,integrityHash:_sourceDigest,...source}=sourceFinality;
 const {finalityBlockHash:_destinationHead,finalityBlockNumberAtomic:_destinationHeight,...destination}=destinationReceipt;
 return {...identity,sourceFinality:source,destinationReceipt:destination};
}
