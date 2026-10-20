import { ApnError } from "../../errors.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { landedTokenCleanups, type UniswapTokenAttempt, type UniswapTokenOperation, type UniswapTokenSwapNonceProof } from "./token-operation.js";
import { tokenBatch, tokenBlock, tokenQuantity, type TokenRpcCall } from "./token-rpc.js";

/** What the finalized chain shows for the cleanup that took the swap marker's nonce. */
export interface TokenNonceConsumption { readonly finalizedNonce: string; readonly blockNumber: string; readonly blockHash: string; readonly finalizedBlockNumber: string }
/** A finalized block past the route's deadline at which the account's nonce had not yet reached `fromNonce`. */
export type TokenNonceUnused = NonNullable<UniswapTokenSwapNonceProof["unused"]>;
/** The chain reads a principal release spends on its swap markers' nonces. */
export interface TokenSwapNonceReads {
  swapNonceConsumed?(operation: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
  swapNonceUnused?(operation: UniswapTokenOperation, fromNonce: string): Promise<TokenNonceUnused | null>;
}

/**
 * The finalized chain's proof that no swap carrying any of `nonces` (a swap marker's, ascending) can land: a nonce a landed
 * cleanup of this operation took is shown held by it (the cleanup at that nonce in a finalized block); every other nonce is
 * shown unused by one read, the account's finalized nonce at or below the lowest of them at a block past the deadline.
 * Null when either is not proven: the hold then stays.
 */
export async function proveSwapNoncesUnusable(op: UniswapTokenOperation, nonces: readonly string[],
  reads: TokenSwapNonceReads): Promise<UniswapTokenSwapNonceProof | null> {
  const landed = landedTokenCleanups(op), cleanups: UniswapTokenSwapNonceProof["cleanups"][number][] = [], open: string[] = [];
  for (const nonce of nonces) {
    const cleanup = landed.find((row) => row.nonce === nonce);
    if (cleanup === undefined) { open.push(nonce); continue; }
    const held = await reads.swapNonceConsumed?.(op, cleanup) ?? null; if (held === null) return null;
    cleanups.push({ swapNonce: nonce, cleanupTransactionHash: cleanup.transactionHash!, cleanupBlockNumber: held.blockNumber,
      cleanupBlockHash: held.blockHash, finalizedBlockNumber: held.finalizedBlockNumber, finalizedNonce: held.finalizedNonce });
  }
  const unused = open[0] === undefined ? null : await reads.swapNonceUnused?.(op, open[0]) ?? null;
  return open.length > 0 && unused === null ? null : { swapNonces: [...nonces], cleanups, unused };
}

/**
 * One primary batch, so one node answers both: the finalized block, then the account's nonce at the finalized tag. Proven
 * only when that block's timestamp is past the route's deadline (the router refuses the swap in any later block) and the
 * nonce is at or below `fromNonce` (nothing with it, or any higher nonce, was included up to that block). The block is
 * asked first: a node whose finalized tag moves between the two answers can only answer the nonce at a later finalized
 * block, whose nonce is no lower, so the proof still holds at the block read. No state is read at an old block.
 */
export async function readSwapNonceUnused(call: TokenRpcCall, op: UniswapTokenOperation, fromNonce: string): Promise<TokenNonceUnused | null> {
  const [rawBlock, rawNonce] = await tokenBatch(call, "primary", [
    { method: "eth_getBlockByNumber", params: ["finalized", false], cachePolicy: "none", decoder: tokenBlock },
    { method: "eth_getTransactionCount", params: [op.account, "finalized"], cachePolicy: "none", decoder: tokenQuantity }]);
  const block = evmRpcRecord(rawBlock), timestamp = evmRpcQuantity(block.timestamp), finalizedNonce = evmRpcQuantity(rawNonce);
  if (timestamp <= BigInt(op.route.deadline) || finalizedNonce > BigInt(fromNonce)) return null;
  return { fromNonce, finalizedNonce: finalizedNonce.toString(), finalizedBlockNumber: evmRpcQuantity(block.number).toString(),
    finalizedBlockHash: evmRpcHex(block.hash, 32), finalizedBlockTimestamp: timestamp.toString() };
}

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
 * R4 for an owner-abandoned swap: its abandon keeps the principal held only while an effect of it could still land. With no
 * swap marker nothing of the swap was ever bound; a hashless marker still needs custody to show it never signed (the forward
 * command checks it under the account lock). A bound or retired swap, a receipt or a recorded release: null.
 */
export function abandonedPrincipalCandidate(op: UniswapTokenOperation): { readonly swap: UniswapTokenAttempt | null } | null {
  if (op.phase !== "abandoned_unknown" || op.usageState !== "reserved" || op.principalRelease !== undefined || op.receipt !== null ||
    (op.retiredEffects ?? []).some((row) => row.kind === "swap")) return null;
  const swap = op.swapAttempt;
  return swap === null || swap.transactionHash === null ? { swap } : null;
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
