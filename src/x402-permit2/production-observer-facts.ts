import { encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../errors.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import { reconstructPermit2ProductionMaterial, type Permit2ProductionMaterial } from "./production-material.js";
import type { Permit2DirectTransactionInput } from "./production-proxy-call.js";
import type { Permit2ReceiptInput } from "./production-receipt-facts.js";
import { PERMIT2_ADDRESS } from "./registry.js";

const TOKEN = parseAbi(["function nonces(address owner) view returns (uint256)"]);
const PERMIT2 = parseAbi(["function nonceBitmap(address owner,uint256 wordPos) view returns (uint256)"]);
export type Permit2ObservedBlock = ReturnType<typeof observerBlock>;
export function observerBlock(value: unknown, tag: string) {
  const block = evmRpcBlockResult(value, tag), timestamp = evmRpcQuantity(block.raw.timestamp);
  return Object.freeze({ tag: block.tag, number: block.number, hash: block.hash, timestamp });
}
export function assertObserverChain(value: unknown): void { if (evmRpcQuantity(value) !== 43114n) mismatch(); }
export function observerNonceCalls(material: Permit2ProductionMaterial, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[] {
  const p = reconstructPermit2ProductionMaterial(material), pinned = { blockHash: block.hash, requireCanonical: true };
  return [{ method: "eth_call", params: [{ to: PERMIT2_ADDRESS, data: encodeFunctionData({ abi: PERMIT2,
    functionName: "nonceBitmap", args: [p.payer, BigInt(material.nonce) >> 8n] }) }, pinned] },
    ...(p.plan.eip2612 === null ? [] : [{ method: "eth_call", params: [{ to: p.token,
      data: encodeFunctionData({ abi: TOKEN, functionName: "nonces", args: [p.payer] }) }, pinned] }]) ];
}
/** Permit2 unordered nonces are single-use and APN signed one witness transfer with this nonce: a set bit is settlement. */
export function nonceConsumed(material: Permit2ProductionMaterial, value: unknown): boolean {
  return ((evmRpcWord(value) >> (BigInt(material.nonce) & 255n)) & 1n) === 1n;
}
export function assertExpiredUnused(material: Permit2ProductionMaterial, block: Permit2ObservedBlock, values: readonly unknown[]): void {
  const p = reconstructPermit2ProductionMaterial(material), permit = p.plan.eip2612;
  if (block.timestamp <= BigInt(p.plan.authorization.deadline) || permit !== null && block.timestamp <= BigInt(permit.info.deadline) ||
      values.length !== (permit === null ? 1 : 2) || ((evmRpcWord(values[0]) >> (BigInt(material.nonce) & 255n)) & 1n) !== 0n ||
      permit !== null && evmRpcWord(values[1]) !== BigInt(permit.info.nonce)) mismatch();
}
/** Select the complete required raw RPC projection, preserving identity and indices before pure attribution. */
export function observerTransaction(value: unknown, locator: string): Permit2DirectTransactionInput {
  const tx = evmRpcRecord(value);
  if (tx.hash !== locator || !/^0x[0-9a-fA-F]{40}$/u.test(String(tx.from)) || /^0x0{40}$/u.test(String(tx.from))) mismatch();
  evmRpcQuantity(tx.transactionIndex);
  return { chainId: tx.chainId as "0xa86a", to: tx.to as Permit2DirectTransactionInput["to"], value: tx.value as "0x0",
    input: tx.input as Permit2DirectTransactionInput["input"], hash: tx.hash as Permit2DirectTransactionInput["hash"],
    blockHash: tx.blockHash as Permit2DirectTransactionInput["blockHash"], blockNumber: tx.blockNumber as string };
}
export function observerReceipt(value: unknown, transaction: unknown): Permit2ReceiptInput {
  const receipt = evmRpcRecord(value), tx = evmRpcRecord(transaction);
  if (!Array.isArray(receipt.logs) || receipt.logs.length > 4096 || receipt.transactionIndex !== tx.transactionIndex ||
      typeof receipt.from !== "string" || typeof receipt.to !== "string" ||
      receipt.from.toLowerCase() !== String(tx.from).toLowerCase() || receipt.to.toLowerCase() !== String(tx.to).toLowerCase()) mismatch();
  return { transactionHash: receipt.transactionHash as Permit2ReceiptInput["transactionHash"],
    blockHash: receipt.blockHash as Permit2ReceiptInput["blockHash"], blockNumber: receipt.blockNumber as string,
    status: receipt.status as "0x0" | "0x1", logs: receipt.logs.map(value => {
      const log = evmRpcRecord(value);
      if (log.transactionIndex !== tx.transactionIndex) mismatch();
      return { address: log.address as string, topics: log.topics as Permit2ReceiptInput["logs"][number]["topics"],
        data: log.data as Permit2ReceiptInput["logs"][number]["data"], logIndex: log.logIndex as string,
        transactionHash: log.transactionHash as Permit2ReceiptInput["transactionHash"], blockHash: log.blockHash as Permit2ReceiptInput["blockHash"],
        blockNumber: log.blockNumber as string, removed: log.removed as false };
    }) };
}
function mismatch(): never { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Permit2 canonical observation is unavailable or inconsistent."); }
