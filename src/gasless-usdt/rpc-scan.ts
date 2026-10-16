import { toEventSelector } from "viem";
import { addressWord, rpcAddress, rpcHex, rpcQuantity, rpcRecord } from "../gasless/rpc-codec.js";
import type { Hex } from "../model.js";
import { usdtFailure } from "./model.js";
import type { UsdtUserOperationScan, UsdtUserOperationScanInput } from "./recovery.js";
import type { UsdtJsonRpc } from "./rpc.js";

const USER_OPERATION_EVENT = toEventSelector(
  "UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
/** Ethereum proof-of-stake slot length: consecutive blocks are at least this many seconds apart. */
const SLOT_SECONDS = 12n;
/** Topic-filtered ranges public RPCs accept; the whole scan stays one batch of at most eleven ranges and one header. */
const LOG_WINDOW = 100n;
const LOG_WINDOWS = 11n;

interface Header { readonly number: bigint; readonly hash: Hex; readonly timestamp: bigint }
function header(value: unknown): Header {
  const block = rpcRecord(value);
  return { number: rpcQuantity(block.number), hash: rpcHex(block.hash, 32, 32), timestamp: rpcQuantity(block.timestamp) };
}
const quantity = (value: bigint): Hex => `0x${value.toString(16)}`;

/**
 * Two batches: chain identity with the finalized head and the prepared anchor, then the topic-filtered EntryPoint logs
 * from that anchor through the last block that could still include the operation, with that block's header. A block
 * whose timestamp is after the signed paymaster `validUntil` can never include it, and post-merge blocks are at least one
 * 12-second slot apart, so the range is bounded by `validUntil` rather than by how late recovery runs.
 */
export async function scanUsdtUserOperation(rpc: Pick<UsdtJsonRpc, "batch">,
  input: UsdtUserOperationScanInput): Promise<UsdtUserOperationScan> {
  const [rawChain, rawFinalized, rawFrom] = await rpc.batch([{ method: "eth_chainId", params: [] },
    { method: "eth_getBlockByNumber", params: ["finalized", false] },
    { method: "eth_getBlockByNumber", params: [quantity(input.fromBlock), false] }]);
  if (rpcQuantity(rawChain) !== 1n) usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_chain");
  const finalized = header(rawFinalized), from = header(rawFrom);
  if (from.number !== input.fromBlock || from.hash !== input.fromBlockHash.toLowerCase()) {
    usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_scan_anchor_not_canonical");
  }
  if (finalized.number < input.fromBlock) {
    return { status: "not_found", final: false, finalizedBlock: finalized.number, endBlock: finalized.number, endBlockHash: null };
  }
  const lastPossible = input.fromBlock + (input.validUntil > from.timestamp ? (input.validUntil - from.timestamp) / SLOT_SECONDS : 0n) + 1n;
  const end = finalized.number < lastPossible ? finalized.number : lastPossible;
  const span = end - input.fromBlock + 1n, ceiling = (span + LOG_WINDOWS - 1n) / LOG_WINDOWS;
  const size = ceiling > LOG_WINDOW ? ceiling : LOG_WINDOW;
  const topics = [USER_OPERATION_EVENT, input.userOpHash.toLowerCase(), addressWord(input.sender), addressWord(input.paymaster)];
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let start = input.fromBlock; start <= end; start += size) ranges.push({ from: start, to: start + size - 1n < end ? start + size - 1n : end });
  const values = await rpc.batch([...ranges.map(range => ({ method: "eth_getLogs", params: [{ address: input.entryPoint,
    fromBlock: quantity(range.from), toBlock: quantity(range.to), topics }] })),
  { method: "eth_getBlockByNumber", params: [quantity(end), false] }]);
  const endBlock = header(values.at(-1));
  if (endBlock.number !== end || (end === finalized.number && endBlock.hash !== finalized.hash)) {
    usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_scan_end_block");
  }
  const found = new Set<Hex>();
  for (const [index, value] of values.slice(0, -1).entries()) {
    if (!Array.isArray(value) || value.length > 16) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_scan_logs");
    for (const item of value) {
      const log = rpcRecord(item), number = rpcQuantity(log.blockNumber);
      if (rpcAddress(log.address) !== input.entryPoint || log.removed === true || number < ranges[index]!.from ||
        number > ranges[index]!.to || !Array.isArray(log.topics) || log.topics.length !== 4 ||
        log.topics.some((topic, at) => rpcHex(topic, 32, 32) !== topics[at])) {
        usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_scan_log_identity");
      }
      found.add(rpcHex(log.transactionHash, 32, 32));
    }
  }
  if (found.size > 1) usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_scan_ambiguous");
  const transactionHash = [...found][0];
  if (transactionHash !== undefined) return { status: "found", transactionHash };
  // Final only when every block that could include the operation is finalized and was scanned.
  const final = finalized.timestamp > input.validUntil && endBlock.timestamp > input.validUntil;
  return { status: "not_found", final, finalizedBlock: finalized.number, endBlock: end, endBlockHash: endBlock.hash };
}
