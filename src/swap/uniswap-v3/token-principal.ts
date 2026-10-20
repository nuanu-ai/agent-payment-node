import { ApnError } from "../../errors.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { landedTokenCleanups, type UniswapTokenAttempt, type UniswapTokenOperation } from "./token-operation.js";
import { tokenBatch, tokenBlock, tokenQuantity, type TokenRpcCall } from "./token-rpc.js";

/** What the finalized chain shows for the cleanup that took the swap marker's nonce. */
export interface TokenNonceConsumption { readonly finalizedNonce: string; readonly blockNumber: string; readonly blockHash: string; readonly finalizedBlockNumber: string }

/**
 * How a cleaned swap whose principal is still held could prove that no swap of it can land: nothing to read when no swap
 * marker is left (never signed), the landed cleanup that reused a hashless swap marker's nonce otherwise; null when the
 * record holds no such proof (a bound or retired swap settles by its own observation, an unrelated nonce proves nothing).
 */
export function principalReleaseCandidate(op: UniswapTokenOperation): { readonly kind: "swap_never_signed" } |
  { readonly kind: "swap_nonce_consumed_by_cleanup"; readonly swap: UniswapTokenAttempt; readonly cleanup: UniswapTokenAttempt } | null {
  if (op.phase !== "cleaned" || op.usageState !== "reserved" || op.receipt !== null || (op.retiredEffects ?? []).some((row) => row.kind === "swap")) return null;
  const swap = op.swapAttempt; if (swap === null) return { kind: "swap_never_signed" };
  if (swap.transactionHash !== null) return null;
  const cleanup = landedTokenCleanups(op).find((row) => row.nonce === swap.nonce);
  return cleanup === undefined ? null : { kind: "swap_nonce_consumed_by_cleanup", swap, cleanup };
}

/**
 * One primary batch, so one node answers all three: the account's nonce at the finalized tag, the cleanup transaction by
 * its own hash, and the finalized head. Proven only when that node has the cleanup (signed by the account, chain 1, the
 * swap marker's nonce) in a block at or below the finalized head, the finalized nonce is past it, and the canonical block
 * at the cleanup's height is the one the transaction names (read next on the same primary: the height is known only from
 * the transaction, and a block at or below the finalized head is final): the finalized chain then holds this cleanup at
 * that nonce, so no transaction of the swap with it can ever be included. Anything else (an unknown or pending cleanup, a
 * head not yet past it, another block at its height) proves nothing and returns null; no state is read at an old block.
 */
export async function readSwapNonceConsumption(call: TokenRpcCall, op: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null> {
  const hash = cleanup.transactionHash; if (hash === null) return null;
  const [rawNonce, rawTransaction, rawFinalized] = await tokenBatch(call, "primary", [
    { method: "eth_getTransactionCount", params: [op.account, "finalized"], cachePolicy: "none", decoder: tokenQuantity },
    { method: "eth_getTransactionByHash", params: [hash], cachePolicy: "none", decoder: (value) => value === null ? value : evmRpcRecord(value) },
    { method: "eth_getBlockByNumber", params: ["finalized", false], cachePolicy: "none", decoder: tokenBlock }]);
  if (rawTransaction === null) return null;
  const transaction = evmRpcRecord(rawTransaction);
  if (evmRpcHex(transaction.hash, 32) !== hash.toLowerCase()) throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered another transaction than the one asked for.");
  if (evmRpcAddress(transaction.from) !== op.account || evmRpcQuantity(transaction.chainId) !== 1n || evmRpcQuantity(transaction.nonce).toString() !== cleanup.nonce)
    throw new ApnError("APN_OPERATION_BLOCKED", "Cleanup transaction evidence conflicts with its record.", { reason: "uniswap_token_transaction_conflict" });
  if (transaction.blockNumber === null || transaction.blockNumber === undefined) return null;
  const blockNumber = evmRpcQuantity(transaction.blockNumber), blockHash = evmRpcHex(transaction.blockHash, 32), finalizedNonce = evmRpcQuantity(rawNonce),
    finalized = evmRpcQuantity(evmRpcRecord(rawFinalized).number);
  if (blockNumber > finalized || finalizedNonce <= BigInt(cleanup.nonce)) return null;
  const [rawBlock] = await tokenBatch(call, "primary", [
    { method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false], cachePolicy: "none", decoder: (value) => value === null ? value : tokenBlock(value) }]);
  if (rawBlock === null || evmRpcHex(evmRpcRecord(rawBlock).hash, 32) !== blockHash) return null;
  return { finalizedNonce: finalizedNonce.toString(), blockNumber: blockNumber.toString(), blockHash, finalizedBlockNumber: finalized.toString() };
}
