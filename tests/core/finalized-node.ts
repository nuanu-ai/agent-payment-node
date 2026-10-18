import assert from "node:assert/strict";
import type { FinalizedBatchRead, FinalizedReadCall } from "../../src/evm-finalized-proof.js";

/** The block a test operation read before it signed anything, and the one transaction its body holds. */
export const ERA = Object.freeze({ number: 12345n, hash: `0x${"e1".repeat(32)}` });
export const ERA_PROBE = `0x${"9a".repeat(32)}`;
const hex = (value: bigint) => `0x${value.toString(16)}`;

export interface FinalizedNodeOptions {
  /** The era block this node may be asked for (defaults to ERA). */
  readonly era?: { readonly number: bigint; readonly hash: string };
  /** How the node holds the era block: as canonical (default), not at all, replaced at its height by a reorg, or empty. */
  readonly eraBody?: "held" | "absent" | "reorged" | "empty";
  /** Only blocks at or above this height are in the node's transaction index (geth `--history.transactions`); 0n by default. */
  readonly indexFrom?: bigint;
  /** Transactions that landed, by hash: the height of the block each is in. */
  readonly landed?: Readonly<Record<string, bigint>>;
  /** Transactions the node holds in its pending pool. */
  readonly pending?: readonly string[];
}

/**
 * A finalized-tag node for the never-lands proof: chain id, the account's finalized nonce, block data (never pruned
 * here; whole bodies are never served) and a transaction index pruned from its tail. Each batch is one node's answer;
 * `batches` records their methods.
 */
export function finalizedNode(chainId: number, finalizedNonce: () => bigint, options: FinalizedNodeOptions = {}) {
  const era = options.era ?? ERA, body = options.eraBody ?? "held", batches: string[][] = [];
  const blockHashAt = (height: bigint) => height === era.number ? era.hash.toLowerCase() : `0x${height.toString(16).padStart(64, "0")}`;
  const answer = ({ method, params }: FinalizedReadCall): unknown => {
    const [first] = params;
    if (method === "eth_chainId") return hex(BigInt(chainId));
    if (method === "eth_getTransactionCount") { assert.equal(params[1], "finalized", "the nonce is read at the finalized tag only"); return hex(finalizedNonce()); }
    if (["eth_getBlockTransactionCountByNumber", "eth_getTransactionByBlockNumberAndIndex", "eth_getBlockTransactionCountByHash",
      "eth_getTransactionByBlockHashAndIndex"].includes(method)) {
      const byNumber = method.includes("Number"), count = method.startsWith("eth_getBlockTransactionCount");
      const asked = byNumber ? first === hex(era.number) : String(first).toLowerCase() === era.hash.toLowerCase();
      if (!count) assert.equal(params[1], "0x0", "only the era block's first transaction is read");
      if (!asked || body === "absent" || body === "reorged" && !byNumber) return null;
      if (body === "empty") return count ? "0x0" : null;
      const blockHash = body === "reorged" ? `0x${"0f".repeat(32)}` : era.hash, hash = body === "reorged" ? `0x${"0e".repeat(32)}` : ERA_PROBE;
      return count ? "0x3" : { hash, blockHash, blockNumber: hex(era.number), transactionIndex: "0x0" };
    }
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") {
      const hash = String(first).toLowerCase();
      if (method === "eth_getTransactionByHash" && options.pending?.some(item => item.toLowerCase() === hash)) return { hash, blockHash: null, blockNumber: null };
      const height = hash === ERA_PROBE ? (body === "held" ? era.number : undefined) : options.landed?.[hash];
      if (height === undefined || height < (options.indexFrom ?? 0n)) return null;
      const block = { blockNumber: hex(height), blockHash: blockHashAt(height) };
      return method === "eth_getTransactionByHash" ? { hash, ...block } : { transactionHash: hash, status: "0x1", ...block };
    }
    throw new Error(`unexpected ${method}`);
  };
  const batch: FinalizedBatchRead = async calls => { batches.push(calls.map(call => call.method)); return calls.map(answer); };
  return { batch, batches };
}
