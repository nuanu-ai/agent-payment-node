import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction, toRlp, type Address, type Hex } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { CIRCLE_RECIPIENT, CIRCLE_TRANSMITTER, circleLegacyRoute } from "./catalog.js";
import { assertCircleSource, circleFail, circleHex, circleRecord, circleUint, type CircleReceiptProof, type CircleSourceProof } from "./protocol.js";
import type { CircleOperationV1 } from "./operation-model.js";

export interface CircleExternalFulfillment {
  readonly schemaVersion: "apn.circle-external-fulfillment.v1"; readonly operationId: string; readonly fingerprint: string;
  readonly sourceTransactionHash: Hex; readonly sourceMessageHash: Hex; readonly attestedMessageHash: Hex; readonly nonce: Hex;
  readonly destinationChain: number; readonly recipient: Address; readonly token: Address; readonly grossAtomic: "40100";
  readonly issuerFeeAtomic: string; readonly netAtomic: string; readonly caller: Address; readonly controlledDestinationNativeAtomic: "0";
  readonly sourceApprovalActualFeeAtomic: string; readonly sourceBurnActualFeeAtomic: string;
  readonly destinationReceipt: CircleReceiptProof; readonly sourceFinality: CircleSourceProof;
  readonly recipientBalance: { readonly parentHash: Hex; readonly parentNumberAtomic: string; readonly before: string; readonly after: string; readonly delta: string };
  readonly historicalDeploymentDigest: string; readonly claimDigest: string; readonly evidenceHash: string; readonly proofHash: string;
}
const HEADER_BYTES = ["parentHash", "sha3Uncles", "miner", "stateRoot", "transactionsRoot", "receiptsRoot", "logsBloom"] as const;
const HEADER_QUANTITIES = ["difficulty", "number", "gasLimit", "gasUsed", "timestamp"] as const;
function rlpQuantity(v: unknown): Hex { const n = circleUint(v); if (n === 0n) return "0x"; const h = n.toString(16); return `0x${h.padStart(Math.ceil(h.length / 2) * 2, "0")}`; }
/** Recompute the actual Ethereum-compatible RLP header, including contiguous fork suffixes. */
export function circleExternalHeader(value: unknown): Hex {
  const b = circleRecord(value), fields: Hex[] = HEADER_BYTES.map(k => circleHex(b[k], k === "miner" ? 20 : k === "logsBloom" ? 256 : 32));
  fields.push(...HEADER_QUANTITIES.map(k => rlpQuantity(b[k])), circleHex(b.extraData), circleHex(b.mixHash, 32), circleHex(b.nonce, 8));
  if (String(b.extraData).length > 514 || circleUint(b.gasUsed) > circleUint(b.gasLimit)) circleFail("external_header_bounds");
  const suffix = ["baseFeePerGas", "withdrawalsRoot", "blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot", "requestsHash"];
  let absent = false;
  for (const k of suffix) { if (b[k] === undefined) { absent = true; continue; } if (absent) circleFail("external_header_fork_gap");
    fields.push(["baseFeePerGas", "blobGasUsed", "excessBlobGas"].includes(k) ? rlpQuantity(b[k]) : circleHex(b[k], 32)); }
  const hash = keccak256(toRlp(fields)); if (hash !== circleHex(b.hash, 32)) circleFail("external_header_hash"); return hash;
}
export async function circleExternalTransaction(value: unknown): Promise<{ hash: Hex; caller: Address; feePrice: bigint }> {
  const t = circleRecord(value), chainId = Number(circleUint(t.chainId)), nonce = Number(circleUint(t.nonce)), type = circleUint(t.type);
  if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(nonce)) circleFail("external_transaction_quantity");
  const common = { chainId, nonce, gas: circleUint(t.gas), to: getAddress(String(t.to)), value: circleUint(t.value), data: circleHex(t.input) };
  const signatureScalar = (value: unknown): Hex => { if(typeof value!=="string"||!/^0x[a-fA-F0-9]{1,64}$/u.test(value))circleFail("external_signature_noncanonical"); const n=BigInt(value); if(n >= 1n << 256n) circleFail("external_signature_noncanonical"); return `0x${n.toString(16).padStart(64,"0")}`; };
  const signature = { r: signatureScalar(t.r), s: signatureScalar(t.s), v: circleUint(t.v) };
  const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  if(BigInt(signature.r)<=0n||BigInt(signature.r)>=order||BigInt(signature.s)<=0n||BigInt(signature.s)>order/2n)circleFail("external_signature_noncanonical");
  if(type===0n&&signature.v!==BigInt(chainId)*2n+35n&&signature.v!==BigInt(chainId)*2n+36n || type===2n&&signature.v!==0n&&signature.v!==1n)circleFail("external_signature_chain_parity");
  let raw: Hex, feePrice: bigint;
  if (type === 0n) { feePrice = circleUint(t.gasPrice); raw = serializeTransaction({ ...common, type: "legacy", gasPrice: feePrice }, signature); }
  else if (type === 2n) { if (!Array.isArray(t.accessList) || t.accessList.length !== 0) circleFail("external_access_list");
    feePrice = circleUint(t.maxFeePerGas); raw = serializeTransaction({ ...common, type: "eip1559", accessList: [], maxFeePerGas: feePrice,
      maxPriorityFeePerGas: circleUint(t.maxPriorityFeePerGas) }, signature); }
  else circleFail("external_transaction_type");
  const hash = keccak256(raw), caller = await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] });
  if (hash !== circleHex(t.hash, 32) || caller !== getAddress(String(t.from))) circleFail("external_transaction_hash_or_signer");
  return { hash, caller, feePrice };
}
export function externalClaimKey(op: CircleOperationV1): string {
  if (op.attestation === null || op.source === null) circleFail("external_claim_source");
  return hashObject({ chain:op.destinationChain,transmitter:CIRCLE_TRANSMITTER,nonce:op.attestation.nonce });
}
export function validateExternalFulfillment(p: CircleExternalFulfillment, op: CircleOperationV1): void {
  if (!isPlainRecord(p) || !exactKeys(p,["schemaVersion","operationId","fingerprint","sourceTransactionHash","sourceMessageHash","attestedMessageHash","nonce","destinationChain","recipient","token","grossAtomic","issuerFeeAtomic","netAtomic","caller","controlledDestinationNativeAtomic","sourceApprovalActualFeeAtomic","sourceBurnActualFeeAtomic","destinationReceipt","sourceFinality","recipientBalance","historicalDeploymentDigest","claimDigest","evidenceHash","proofHash"])) circleFail("external_proof_shape");
  assertCircleSource(p.sourceFinality);
  const {proofHash,...body}=p, route=circleLegacyRoute(op.destinationChain,op.destinationProfile), balance=p.recipientBalance;
  if (p.schemaVersion !== "apn.circle-external-fulfillment.v1" || proofHash !== hashObject(body) || p.operationId !== op.operationId || p.fingerprint !== op.fingerprint ||
    p.sourceTransactionHash !== op.source?.transactionHash || p.sourceMessageHash !== op.source?.sourceMessageHash || p.attestedMessageHash !== op.attestation?.hash || p.nonce !== op.attestation?.nonce ||
    p.destinationChain !== op.destinationChain || p.recipient !== CIRCLE_RECIPIENT || p.token !== route.token || p.grossAtomic !== "40100" || p.issuerFeeAtomic !== op.attestation?.feeExecutedAtomic || p.netAtomic !== op.attestation?.receivedAtomic ||
    p.controlledDestinationNativeAtomic !== "0" || getAddress(p.caller) !== p.caller || p.caller === route.gasPayer || p.sourceFinality.finalityTag !== "finalized" || p.destinationReceipt.finalityTag !== "safe" ||
    p.sourceFinality.sourceMessageHash !== p.sourceMessageHash || p.sourceFinality.transactionHash !== p.sourceTransactionHash ||
    p.sourceApprovalActualFeeAtomic !== op.effects[0]?.proof?.actualFeeAtomic || p.sourceBurnActualFeeAtomic !== p.sourceFinality.actualFeeAtomic ||
    ![p.historicalDeploymentDigest,p.claimDigest,p.evidenceHash].every(x=>/^[a-f0-9]{64}$/u.test(x)) ||
    !isPlainRecord(balance) || !exactKeys(balance,["parentHash","parentNumberAtomic","before","after","delta"]) || circleUint(balance.after)-circleUint(balance.before) !== BigInt(p.netAtomic) || balance.delta !== p.netAtomic ||
    circleUint(balance.parentNumberAtomic)+1n !== BigInt(p.destinationReceipt.blockNumberAtomic)) circleFail("external_proof_binding");
  circleHex(balance.parentHash,32);
  const receipt=p.destinationReceipt;
  if(!isPlainRecord(receipt)||!exactKeys(receipt,["transactionHash","blockHash","blockNumberAtomic","finalityBlockHash","finalityBlockNumberAtomic","transactionHashBinding","finalityTag","receiptHash","logsHash","actualFeeAtomic"]) ||
    ![receipt.transactionHashBinding,receipt.receiptHash,receipt.logsHash].every(x=>/^[a-f0-9]{64}$/u.test(x)) || circleUint(receipt.finalityBlockNumberAtomic)<circleUint(receipt.blockNumberAtomic))circleFail("external_receipt_proof_shape");
  for(const x of [receipt.transactionHash,receipt.blockHash,receipt.finalityBlockHash])circleHex(x,32);
  for(const x of [receipt.actualFeeAtomic,p.sourceApprovalActualFeeAtomic,p.sourceBurnActualFeeAtomic])circleUint(x);
  if(p.claimDigest!==externalClaimKey(op))circleFail("external_claim_digest");
}
