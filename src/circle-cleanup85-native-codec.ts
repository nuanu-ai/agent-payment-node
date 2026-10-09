import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerializedEIP1559 } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmRpcAddress as address, evmRpcHex as hex, evmRpcQuantity as quantity, evmRpcRecord as record } from "./evm-rpc-codec.js";
import type { Cleanup85CancellationEnvelope, Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { CircleObservation } from "./circle-v2-evm/protocol.js";

export const CLEANUP85_OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export const CLEANUP85_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export const CLEANUP85_FEE_CAP = 2_000_000_000_000n;
export const CLEANUP85_REQUEST = Object.freeze({
  parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33",
  oldCleanupTransactionHash: "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95",
  oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468",
  oldCleanupEnvelopeHash: "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583",
});
export function cleanup85Blocked(reason: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", `Finite cleanup85 cancellation refused: ${reason}.`, { reason: `cleanup85_${reason}` });
}
export function validateCleanup85Request(value: unknown): Cleanup85CancellationRequest {
  if (!isPlainRecord(value) || !exactKeys(value, [...Object.keys(CLEANUP85_REQUEST), "recoveryBinding", "parentIntentHash"]) ||
    Object.entries(CLEANUP85_REQUEST).some(([key, expected]) => value[key] !== expected) ||
    ![value.recoveryBinding, value.parentIntentHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))) cleanup85Blocked("request_binding");
  return Object.freeze({ ...value }) as unknown as Cleanup85CancellationRequest;
}
const atomic = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) cleanup85Blocked("envelope_quantity");
  return BigInt(value);
};
const bump = (n: bigint): bigint => (n * 9n + 7n) / 8n;
export function cleanup85Envelope(gas: string, currentMaxFee: string, currentPriority: string): Cleanup85CancellationEnvelope {
  const maximum = [45_000_000n, atomic(currentMaxFee)].reduce((a, b) => a > b ? a : b);
  const priority = [1n, bump(0n), atomic(currentPriority)].reduce((a, b) => a > b ? a : b);
  const body = { chainId: 42161 as const, from: CLEANUP85_OWNER, to: CLEANUP85_RECIPIENT, nonceAtomic: "85" as const,
    valueAtomic: "1" as const, data: "0x" as const, gasLimitAtomic: gas, maxFeePerGasAtomic: maximum.toString(),
    maxPriorityFeePerGasAtomic: priority.toString() };
  return validateCleanup85Envelope({ ...body, envelopeHash: hashObject(body) });
}
export function validateCleanup85Envelope(value: unknown): Cleanup85CancellationEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "from", "to", "nonceAtomic", "valueAtomic", "data", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"])) cleanup85Blocked("envelope_shape");
  const e = value as unknown as Cleanup85CancellationEnvelope, { envelopeHash, ...body } = e;
  if (e.chainId !== 42161 || e.from !== CLEANUP85_OWNER || e.to !== CLEANUP85_RECIPIENT || e.nonceAtomic !== "85" || e.valueAtomic !== "1" || e.data !== "0x" ||
    envelopeHash !== hashObject(body) || atomic(e.gasLimitAtomic) < 21_000n || atomic(e.maxFeePerGasAtomic) < bump(40_000_000n) ||
    atomic(e.maxPriorityFeePerGasAtomic) < 1n || atomic(e.maxPriorityFeePerGasAtomic) > atomic(e.maxFeePerGasAtomic) ||
    atomic(e.gasLimitAtomic) * atomic(e.maxFeePerGasAtomic) + 1n > CLEANUP85_FEE_CAP) cleanup85Blocked("envelope_binding_or_cap");
  return e;
}
/** Strict actual native wire codec. A Circle value-zero codec cannot prove this value-one transfer. */
export async function verifyCleanup85Raw(e: Cleanup85CancellationEnvelope, raw: Hex): Promise<Hex> {
  validateCleanup85Envelope(e);
  if (!/^0x02[0-9a-f]+$/u.test(raw) || raw.length > 2050 || raw.length % 2 !== 0) cleanup85Blocked("wire_shape");
  const t = parseTransaction(raw), priority = t.maxPriorityFeePerGas === undefined ? 0n : t.maxPriorityFeePerGas;
  const access = t.accessList === undefined ? [] : t.accessList;
  if (t.type !== "eip1559" || t.chainId !== 42161 || t.to !== CLEANUP85_RECIPIENT || t.nonce !== 85 || t.value !== 1n ||
    (t.data === undefined ? "0x" : t.data) !== "0x" || t.gas !== atomic(e.gasLimitAtomic) || t.maxFeePerGas !== atomic(e.maxFeePerGasAtomic) ||
    priority !== atomic(e.maxPriorityFeePerGasAtomic) || !Array.isArray(access) || access.length !== 0 ||
    getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedEIP1559 })) !== CLEANUP85_OWNER) cleanup85Blocked("signed_wire_binding");
  return keccak256(raw);
}
function transactionWire(t: Record<string, unknown>): TransactionSerializedEIP1559 {
  if (quantity(t.type) !== 2n || !Array.isArray(t.accessList) || t.accessList.length !== 0 ||
    t.authorizationList !== undefined && (!Array.isArray(t.authorizationList) || t.authorizationList.length !== 0)) cleanup85Blocked("wire_type_or_authorization");
  const parity = quantity(t.yParity ?? t.v);
  if (parity > 1n) cleanup85Blocked("wire_parity");
  return serializeTransaction({ type: "eip1559", chainId: Number(quantity(t.chainId)), nonce: Number(quantity(t.nonce)), to: address(t.to),
    data: hex(t.input), value: quantity(t.value), gas: quantity(t.gas), maxFeePerGas: quantity(t.maxFeePerGas), maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGas), accessList: [] },
    { r: hex(t.r, 32), s: hex(t.s, 32), yParity: Number(parity) });
}
export interface Cleanup85NativeReceipt {
  readonly transactionHash: Hex; readonly blockHash: Hex; readonly blockNumberAtomic: string;
  readonly receiptHash: string; readonly actualFeeAtomic: string; readonly nativeConsumedAtomic: string;
}
/** Finalized evidence must contain the exact signed transaction once, at its exact receipt index. */
export async function verifyCleanup85Observation(e: Cleanup85CancellationEnvelope, expectedHash: Hex, input: CircleObservation): Promise<Cleanup85NativeReceipt> {
  validateCleanup85Envelope(e);
  const t = record(input.transaction), r = record(input.receipt), b = record(input.canonicalBlock), again = record(input.recheckedBlock), head = record(input.finalityHead);
  const hash = hex(t.hash, 32), blockHash = hex(b.hash, 32), number = quantity(b.number), index = quantity(t.transactionIndex);
  const gasUsed = quantity(r.gasUsed), price = quantity(r.effectiveGasPrice), fee = gasUsed * price;
  if (input.chainId !== 42161 || input.finalityTag !== "finalized" || hash !== expectedHash || hash === CLEANUP85_REQUEST.oldCleanupTransactionHash ||
    blockHash === `0x${"0".repeat(64)}` || number <= 513145262n || quantity(b.timestamp) < 1791535099n ||
    hex(t.blockHash, 32) !== blockHash || quantity(t.blockNumber) !== number || address(t.from) !== CLEANUP85_OWNER ||
    hex(r.transactionHash, 32) !== hash || quantity(r.status) !== 1n || hex(r.blockHash, 32) !== blockHash || quantity(r.blockNumber) !== number ||
    address(r.from) !== CLEANUP85_OWNER || address(r.to) !== CLEANUP85_RECIPIENT || quantity(r.transactionIndex) !== index ||
    !Array.isArray(r.logs) || r.logs.length !== 0 || gasUsed === 0n || gasUsed > atomic(e.gasLimitAtomic) || price > atomic(e.maxFeePerGasAtomic) || fee + 1n > CLEANUP85_FEE_CAP ||
    !Array.isArray(b.transactions) || index > BigInt(Number.MAX_SAFE_INTEGER) || b.transactions[Number(index)] !== hash || b.transactions.filter(x => x === hash).length !== 1 ||
    hex(again.hash, 32) !== blockHash || quantity(again.number) !== number || quantity(again.timestamp) !== quantity(b.timestamp) ||
    quantity(head.number) < number || quantity(head.timestamp) < quantity(b.timestamp) || hex(head.hash, 32) === `0x${"0".repeat(64)}` ||
    quantity(head.number) === number && hex(head.hash, 32) !== blockHash) cleanup85Blocked("finalized_receipt_binding");
  for (const field of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"]) if (r[field] !== undefined && quantity(r[field]) !== 0n) cleanup85Blocked("unmodeled_fee");
  if (await verifyCleanup85Raw(e, transactionWire(t)) !== hash) cleanup85Blocked("canonical_wire_hash");
  return { transactionHash: hash, blockHash, blockNumberAtomic: number.toString(), receiptHash: hashObject(r), actualFeeAtomic: fee.toString(), nativeConsumedAtomic: (fee + 1n).toString() };
}
