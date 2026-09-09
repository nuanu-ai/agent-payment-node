import { decodeEventLog, encodeAbiParameters, parseAbiParameters, toEventSelector } from "viem";
import type { Abi } from "viem";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { GASLESS_ENTRYPOINT_ABI, GASLESS_PAYMASTER_ABI, GASLESS_TOKEN_ABI } from "./abi.js";
import type { GaslessAccounting, GaslessIntent, GaslessLog, GaslessProtocolReceipt } from "./model.js";
import { GASLESS_ZERO_ADDRESS, gaslessAddress, gaslessChain, gaslessExact, gaslessFailure, gaslessHex,
  gaslessUint } from "./validation.js";

const TOPICS = {
  transfer: toEventSelector("Transfer(address,address,uint256)"),
  approval: toEventSelector("Approval(address,address,uint256)"),
  sponsored: toEventSelector("UserOperationSponsored(address,address,bytes32,uint256,uint256,uint256)"),
  userOperation: toEventSelector("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"),
  postOpRevert: toEventSelector("PostOpRevertReason(bytes32,address,uint256,bytes)"),
  prefundTooLow: toEventSelector("UserOperationPrefundTooLow(bytes32,address,uint256)"),
} as const;

type Transfer = Readonly<{ from: Address; to: Address; value: bigint }>;
type Approval = Readonly<{ owner: Address; spender: Address; value: bigint }>;
type Sponsored = Readonly<{ token: Address; sender: Address; userOpHash: Hex; nativeTokenPrice: bigint;
  actualTokenNeeded: bigint; feeTokenAmount: bigint }>;
type UserOperationEvent = Readonly<{ userOpHash: Hex; sender: Address; paymaster: Address; nonce: bigint;
  success: boolean; actualGasCost: bigint; actualGasUsed: bigint }>;
type FailureFrame = Readonly<{ userOpHash: Hex; sender: Address; nonce: bigint }>;

export function gaslessAccounting(intent: GaslessIntent, userOperationHash: Hex,
  receipt: GaslessProtocolReceipt): GaslessAccounting {
  validateReceipt(intent, userOperationHash, receipt);
  const userOperations = events<UserOperationEvent>(receipt.logs, intent.entryPoint, TOPICS.userOperation,
    GASLESS_ENTRYPOINT_ABI, "UserOperationEvent", 4, 128);
  const ownerOperations = userOperations.filter((event) => event.sender === intent.owner.address);
  const hashOperations = userOperations.filter((event) => event.userOpHash === userOperationHash);
  if (ownerOperations.length !== 1 || hashOperations.length !== 1 || ownerOperations[0] !== hashOperations[0]) receiptFailure();
  const operation = ownerOperations[0]!;
  if (operation.paymaster !== intent.paymaster || operation.nonce.toString() !== intent.initialSnapshot.entryPointNonceAtomic ||
    operation.actualGasCost < 0n || operation.actualGasUsed < 0n) receiptFailure();

  const transfers = events<Transfer>(receipt.logs, intent.token, TOPICS.transfer,
    GASLESS_TOKEN_ABI, "Transfer", 3, 32);
  const approvals = events<Approval>(receipt.logs, intent.token, TOPICS.approval,
    GASLESS_TOKEN_ABI, "Approval", 3, 32);
  validateApprovals(intent, operation.success, approvals);
  const movements = tokenMovements(intent, operation.success, transfers);

  const sponsored = events<Sponsored>(receipt.logs, intent.paymaster, TOPICS.sponsored,
    GASLESS_PAYMASTER_ABI, "UserOperationSponsored", 3, 128);
  const ownerSponsored = sponsored.filter((event) => event.sender === intent.owner.address);
  const matchingSponsored = sponsored.filter((event) => event.userOpHash === userOperationHash);
  const postOp = events<FailureFrame>(receipt.logs, intent.entryPoint, TOPICS.postOpRevert,
    GASLESS_ENTRYPOINT_ABI, "PostOpRevertReason", 3);
  const prefundLow = events<FailureFrame>(receipt.logs, intent.entryPoint, TOPICS.prefundTooLow,
    GASLESS_ENTRYPOINT_ABI, "UserOperationPrefundTooLow", 3, 32);
  const failureFrames = [
    ...matchingFrames(intent, userOperationHash, postOp).map((frame) => ({ kind: "post_op_reverted" as const, frame })),
    ...matchingFrames(intent, userOperationHash, prefundLow).map((frame) => ({ kind: "prefund_too_low" as const, frame })),
  ];

  const prefund = movements.prefund;
  const feeCap = BigInt(intent.feeCapAtomic);
  if (prefund <= 0n || prefund > feeCap) receiptFailure();
  if (matchingSponsored.length === 1 && ownerSponsored.length === 1 && matchingSponsored[0] === ownerSponsored[0]) {
    if (failureFrames.length !== 0) receiptFailure();
    const event = matchingSponsored[0]!;
    if (event.token !== intent.token || event.nativeTokenPrice <= 0n || event.actualTokenNeeded <= 0n ||
      event.feeTokenAmount > event.actualTokenNeeded) receiptFailure();
    const fee = prefund - movements.refund;
    if (movements.refund < 0n || movements.refund > prefund || fee !== minimum(prefund, event.actualTokenNeeded)) receiptFailure();
    return accounting(intent, operation.success, "sponsored", prefund, movements.refund, fee,
      operation.success ? BigInt(intent.recipientAtomic) : 0n, receipt.logs);
  }
  if (matchingSponsored.length !== 0 || ownerSponsored.length !== 0 || sponsored.some((event) => event.token === intent.token &&
    (event.sender === intent.owner.address || event.userOpHash === userOperationHash))) receiptFailure();
  if (operation.success || failureFrames.length !== 1 || movements.refundCount !== 0 || movements.delivery !== 0n) receiptFailure();
  return accounting(intent, false, failureFrames[0]!.kind, prefund, 0n, prefund, 0n, receipt.logs);
}

function tokenMovements(intent: GaslessIntent, success: boolean, transfers: readonly Transfer[]): {
  readonly prefund: bigint; readonly refund: bigint; readonly refundCount: number; readonly delivery: bigint;
} {
  const ownerOut = transfers.filter((event) => event.from === intent.owner.address);
  const prefunds = ownerOut.filter((event) => event.to === intent.paymaster);
  const deliveries = ownerOut.filter((event) => event.to === intent.request.recipient);
  const unexpected = ownerOut.filter((event) => event.to !== intent.paymaster && event.to !== intent.request.recipient);
  const refunds = transfers.filter((event) => event.from === intent.paymaster && event.to === intent.owner.address);
  if (prefunds.length !== 1 || refunds.length > 1 || unexpected.length !== 0 ||
    (refunds.length === 1 && refunds[0]!.value === 0n) ||
    (success ? deliveries.length !== 1 || deliveries[0]!.value.toString() !== intent.recipientAtomic : deliveries.length !== 0)) receiptFailure();
  return { prefund: prefunds[0]!.value, refund: refunds[0]?.value ?? 0n, refundCount: refunds.length,
    delivery: deliveries[0]?.value ?? 0n };
}

function validateApprovals(intent: GaslessIntent, success: boolean, approvals: readonly Approval[]): void {
  const relevant = approvals.filter((event) => event.owner === intent.owner.address);
  const expected = relevant.filter((event) => event.owner === intent.owner.address && event.spender === intent.paymaster);
  if (relevant.length !== expected.length) receiptFailure();
  const permits = expected.filter((event) => event.value.toString() === intent.feeCapAtomic);
  const cleanup = expected.filter((event) => event.value === 0n);
  if (permits.length !== 1 || (success ? cleanup.length !== 1 : cleanup.length !== 0) ||
    expected.length !== permits.length + cleanup.length) receiptFailure();
}

function matchingFrames(intent: GaslessIntent, hash: Hex, frames: readonly FailureFrame[]): readonly FailureFrame[] {
  const owner = frames.filter((frame) => frame.sender === intent.owner.address);
  const matching = frames.filter((frame) => frame.userOpHash === hash);
  if (owner.length !== matching.length || owner.some((frame) => !matching.includes(frame))) receiptFailure();
  for (const frame of matching) if (frame.nonce.toString() !== intent.initialSnapshot.entryPointNonceAtomic) receiptFailure();
  return matching;
}

function validateReceipt(intent: GaslessIntent, userOperationHash: Hex, receipt: GaslessProtocolReceipt): void {
  const keys = ["chainId", "transactionHash", "block", "logs"] as const;
  if (!isPlainRecord(receipt) || !exactKeys(receipt, keys) || gaslessChain(receipt.chainId, "APN_RPC_PROTOCOL") !== intent.request.chainId ||
    gaslessHex(userOperationHash, 32, 32, "APN_RPC_PROTOCOL") !== userOperationHash ||
    userOperationHash === `0x${"0".repeat(64)}` ||
    gaslessHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") !== receipt.transactionHash ||
    receipt.transactionHash === `0x${"0".repeat(64)}` || !Array.isArray(receipt.logs) ||
    receipt.logs.length > 512) receiptFailure();
  const block = gaslessExact(receipt.block, ["numberAtomic", "hash", "timestampAtomic"], "APN_RPC_PROTOCOL");
  gaslessUint(block.numberAtomic, true, "APN_RPC_PROTOCOL");
  gaslessUint(block.timestampAtomic, true, "APN_RPC_PROTOCOL");
  if (gaslessHex(block.hash, 32, 32, "APN_RPC_PROTOCOL") !== block.hash || block.hash === `0x${"0".repeat(64)}`) receiptFailure();
  const indexes = new Set<string>();
  for (const value of receipt.logs) {
    const log = gaslessExact(value, ["address", "topics", "data", "logIndexAtomic"], "APN_RPC_PROTOCOL") as unknown as GaslessLog;
    if (gaslessAddress(log.address, "APN_RPC_PROTOCOL") !== log.address || !Array.isArray(log.topics) || log.topics.length > 4) receiptFailure();
    for (const topic of log.topics) if (gaslessHex(topic, 32, 32, "APN_RPC_PROTOCOL") !== topic) receiptFailure();
    if (gaslessHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL") !== log.data) receiptFailure();
    gaslessUint(log.logIndexAtomic, false, "APN_RPC_PROTOCOL");
    if (indexes.has(log.logIndexAtomic)) receiptFailure();
    indexes.add(log.logIndexAtomic);
  }
  for (const address of [intent.owner.address, intent.token, intent.paymaster, intent.entryPoint, intent.delegate,
    intent.request.recipient]) if (address === GASLESS_ZERO_ADDRESS) receiptFailure();
}

function events<T>(logs: readonly GaslessLog[], address: Address, topic: Hex, abi: Abi,
  eventName: string, topicCount: number, dataBytes?: number): readonly T[] {
  const output: T[] = [];
  for (const log of logs) {
    if (log.address !== address || log.topics[0]?.toLowerCase() !== topic) continue;
    if (log.topics.length !== topicCount || (dataBytes !== undefined && log.data.length !== 2 + dataBytes * 2)) receiptFailure();
    try {
      const decoded = decodeEventLog({ abi, eventName: eventName as never, data: log.data,
        topics: log.topics as [Hex, ...Hex[]], strict: true }) as unknown as { eventName: string; args: T };
      if (decoded.eventName !== eventName) receiptFailure();
      if (eventName === "PostOpRevertReason") {
        const args = decoded.args as unknown as FailureFrame & { revertReason: Hex };
        const canonical = encodeAbiParameters(parseAbiParameters("uint256 nonce,bytes revertReason"), [args.nonce, args.revertReason]);
        if (canonical !== log.data) receiptFailure();
      }
      output.push(decoded.args);
    } catch { receiptFailure(); }
  }
  return output;
}

function accounting(intent: GaslessIntent, success: boolean, branch: GaslessAccounting["branch"], prefund: bigint,
  refund: bigint, fee: bigint, delivered: bigint, logs: readonly GaslessLog[]): GaslessAccounting {
  const gross = BigInt(intent.request.grossAtomic);
  if (fee < 0n || fee > BigInt(intent.feeCapAtomic) || delivered + fee > gross) receiptFailure();
  return { success, branch, prefundAtomic: prefund.toString(), refundAtomic: refund.toString(), feeAtomic: fee.toString(),
    deliveredAtomic: delivered.toString(), logsHash: sha256(canonicalJson(logs)) };
}
function minimum(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function receiptFailure(): never { return gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_unresolved"); }
