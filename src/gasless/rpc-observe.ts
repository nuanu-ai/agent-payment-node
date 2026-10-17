import { hashObject } from "../canonical.js";
import type { Hex } from "../model.js";
import type { GaslessBlock, GaslessChainId, GaslessCursor, GaslessEffectIdentity,
  GaslessIntent, GaslessObservation, GaslessProtocolReceipt } from "./model.js";
import { gaslessAccounting } from "./protocol.js";
import { observeGaslessBootstrap } from "./rpc-bootstrap-observe.js";
import { GASLESS_LOG_REQUEST_BLOCKS, GASLESS_SCAN_WINDOW_BLOCKS, GASLESS_SCAN_WINDOWS } from "./rpc-budget.js";
import { addressWord, parseReceiptLogs, quantity, receiptHash, rpcAddress, rpcBlock, rpcFinalityBlock, rpcHex,
  rpcQuantity, rpcRecord, sameBlock, type GaslessRawBlock, type GaslessRpcCall } from "./rpc-codec.js";
import { gaslessObservedContracts, readAccountAt } from "./rpc-state.js";
import { gaslessOuterTransaction } from "./rpc-transaction.js";
import { gaslessExact, gaslessFailure, gaslessHex, gaslessUint } from "./validation.js";

const USER_OPERATION_EVENT =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" as Hex;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export interface GaslessObservationContext {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpc: GaslessRpcCall;
  readonly bundler?: GaslessRpcCall;
}

/**
 * Archive-free observation. Effects are proven by the authenticated receipt logs and header membership; a settlement
 * reads account state only at the latest head, and the permission-invalidation probe at the safe (Polygon: finalized)
 * and latest heads; never at the prepare, inclusion or scan-cursor block, whose state a keyless node no longer serves.
 */
export async function observeGasless(context: GaslessObservationContext, intent: GaslessIntent,
  identity: GaslessEffectIdentity, cursorInput: GaslessCursor): Promise<GaslessObservation> {
  const cursor = validateCursor(intent, cursorInput);
  validateIdentity(identity);
  if (identity.userOperationHash === null) {
    return await observeGaslessBootstrap(context, intent, identity, cursor);
  }
  const userOperationHash = identity.userOperationHash;
  let candidate: Hex | null = null;
  try { candidate = await bundlerCandidate(context, intent, userOperationHash); }
  catch { /* A locator is never authoritative; canonical EntryPoint scanning follows. */ }
  if (candidate !== null) return await inspectSafely(context, intent, userOperationHash, candidate, cursor);
  const scanned = await scan(context, intent, userOperationHash, cursor);
  // The invalidation probe runs only once the canonical scan reached the current safe head, and reads state there.
  if (scanned.observation.status === "not_found" && scanned.reachedSafe !== null) {
    const invalidation = await observeGaslessBootstrap(context, intent, identity, scanned.observation.cursor, scanned.reachedSafe);
    if (invalidation.status === "permissions_invalidated") return invalidation;
  }
  return scanned.observation;
}

/**
 * Up to `GASLESS_SCAN_WINDOWS` windows per step, each one request: the window's end header and its bounded log ranges.
 * Every scanned block is at or below the safe head, which does not reorganise, so no header is re-read after the logs.
 */
async function scan(context: GaslessObservationContext, intent: GaslessIntent, userOperationHash: Hex,
  input: GaslessCursor): Promise<{ readonly observation: GaslessObservation; readonly reachedSafe: GaslessBlock | null }> {
  let cursor = input;
  try {
    const previousNumber = cursor.previousEndBlock === null ? null : quantity(BigInt(cursor.previousEndBlock.numberAtomic));
    const [safeRaw, previous] = await Promise.all([rpcFinalityBlock(context.rpc, context.chainId),
      previousNumber === null ? Promise.resolve(null) : rpcBlock(context.rpc, previousNumber)]);
    if (previous !== null && !sameBlock(previous.block, cursor.previousEndBlock!)) {
      return { reachedSafe: null, observation: unresolved(initialCursor(cursor.startBlock), null, "gasless_receipt_unresolved",
        hashObject({ reason: "gasless_scan_cursor_reorg", previous: cursor.previousEndBlock, current: previous.block })) };
    }
    const safe = safeRaw.block, safeNumber = BigInt(safe.numberAtomic);
    const filter = { address: intent.entryPoint,
      topics: [USER_OPERATION_EVENT, userOperationHash, addressWord(intent.owner.address), addressWord(intent.paymaster)] };
    const scannedFrom = BigInt(cursor.nextBlockAtomic);
    for (let window = 0; window < GASLESS_SCAN_WINDOWS && BigInt(cursor.nextBlockAtomic) <= safeNumber; window += 1) {
      const start = BigInt(cursor.nextBlockAtomic), end = minimum(safeNumber, start + GASLESS_SCAN_WINDOW_BLOCKS - 1n);
      const ranges: Array<{ from: bigint; to: bigint }> = [];
      for (let from = start; from <= end; from += GASLESS_LOG_REQUEST_BLOCKS) {
        ranges.push({ from, to: minimum(end, from + GASLESS_LOG_REQUEST_BLOCKS - 1n) });
      }
      const [endRaw, ...values] = await Promise.all([rpcBlock(context.rpc, quantity(end)) as Promise<unknown>,
        ...ranges.map(({ from, to }) => context.rpc("eth_getLogs", [{ ...filter, fromBlock: quantity(from), toBlock: quantity(to) }]))]);
      const candidates = scanLogs(intent, userOperationHash, ranges, values);
      if (candidates.size > 1) {
        return { reachedSafe: null, observation: unresolved(cursor, null, "gasless_receipt_unresolved",
          hashObject({ filter, from: start.toString(), to: end.toString(), count: candidates.size })) };
      }
      const candidate = [...candidates][0];
      if (candidate !== undefined) {
        return { reachedSafe: null, observation: await inspectSafely(context, intent, userOperationHash, candidate, cursor) };
      }
      cursor = { startBlock: cursor.startBlock, nextBlockAtomic: (end + 1n).toString(), previousEndBlock: (endRaw as GaslessRawBlock).block };
    }
    const reached = BigInt(cursor.nextBlockAtomic) > safeNumber && cursor.previousEndBlock !== null &&
      sameBlock(cursor.previousEndBlock, safe);
    return { reachedSafe: reached ? safe : null, observation: { status: "not_found", transactionHash: null, settlement: null,
      cursor, evidenceHash: hashObject({ userOperationHash, from: scannedFrom.toString(), cursor, safe }), reason: null } };
  } catch {
    return { reachedSafe: null, observation: unresolved(cursor, null, "gasless_receipt_unresolved", null) };
  }
}

function scanLogs(intent: GaslessIntent, userOperationHash: Hex, ranges: ReadonlyArray<{ from: bigint; to: bigint }>,
  values: readonly unknown[]): Set<Hex> {
  const candidates = new Set<Hex>(); let logCount = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const { from, to } = ranges[index]!, value = values[index];
    if (!Array.isArray(value) || value.length > 128 - logCount) gaslessFailure("APN_RPC_PROTOCOL", "gasless_scan_log_count");
    logCount += value.length;
    for (const item of value) {
      const log = rpcRecord(item), topics = log.topics;
      const number = rpcQuantity(log.blockNumber);
      if (rpcAddress(log.address) !== intent.entryPoint || log.removed !== false || number < from || number > to ||
        !Array.isArray(topics) || topics.length !== 4 || rpcHex(topics[0], 32, 32) !== USER_OPERATION_EVENT ||
        rpcHex(topics[1], 32, 32) !== userOperationHash || rpcHex(topics[2], 32, 32) !== addressWord(intent.owner.address) ||
        rpcHex(topics[3], 32, 32) !== addressWord(intent.paymaster)) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_scan_log_identity");
      }
      rpcHex(log.blockHash, 32, 32); rpcQuantity(log.logIndex); rpcHex(log.data, 256);
      candidates.add(rpcHex(log.transactionHash, 32, 32));
    }
  }
  return candidates;
}

async function inspectSafely(context: GaslessObservationContext, intent: GaslessIntent, userOperationHash: Hex,
  transactionHash: Hex, cursor: GaslessCursor): Promise<GaslessObservation> {
  try { return await inspect(context, intent, userOperationHash, transactionHash, cursor); }
  catch { return unresolved(cursor, null, "gasless_receipt_unresolved", null); }
}

/**
 * Three requests: the transaction and its receipt; the inclusion header (with its transaction list), its parent (the
 * cursor anchor), the safe head and the latest head; then, once safe covers the inclusion, the account at the latest
 * head together with the inclusion header read again. Every success fact is in the receipt logs (UserOperationEvent,
 * permit, transfers, cleanup Approval(0)). The conclusion rests on the receipt at or below the safe header, re-checked
 * by a header read at its height, never on safe-head state: on chains whose safe head trails latest by more than a
 * keyless node's state window (Arbitrum, Unichain) that state is refused. The account is read at latest, every keyless
 * node serves it: nonces only grow, so they show the consumed permission; the residual allowance is informational.
 */
async function inspect(context: GaslessObservationContext, intent: GaslessIntent, userOperationHash: Hex,
  transactionHash: Hex, cursor: GaslessCursor): Promise<GaslessObservation> {
  const [rawTransaction, rawReceipt] = await Promise.all([
    context.rpc("eth_getTransactionByHash", [transactionHash]),
    context.rpc("eth_getTransactionReceipt", [transactionHash]),
  ]);
  if (rawTransaction === null && rawReceipt === null) {
    return { status: "pending", transactionHash, settlement: null, cursor,
      evidenceHash: hashObject({ transactionHash, status: "pending" }), reason: null };
  }
  if (rawTransaction === null || rawReceipt === null) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_unresolved");
  const transaction = rpcRecord(rawTransaction), receipt = rpcRecord(rawReceipt);
  const blockNumber = rpcQuantity(receipt.blockNumber), blockHash = rpcHex(receipt.blockHash, 32, 32);
  const transactionIndex = rpcQuantity(receipt.transactionIndex), type = rpcQuantity(receipt.type);
  if (rpcHex(receipt.transactionHash, 32, 32) !== transactionHash || rpcHex(transaction.blockHash, 32, 32) !== blockHash ||
    rpcQuantity(transaction.blockNumber) !== blockNumber || rpcQuantity(transaction.transactionIndex) !== transactionIndex ||
    rpcQuantity(transaction.type) !== type) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_transaction_membership");
  const start = BigInt(cursor.startBlock.numberAtomic);
  if (blockNumber < start) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_before_prepare");
  const [includedRaw, parentRaw, safeRaw, latestRaw] = await Promise.all([rpcBlock(context.rpc, quantity(blockNumber)),
    blockNumber === start ? Promise.resolve(null) : rpcBlock(context.rpc, quantity(blockNumber - 1n)),
    rpcFinalityBlock(context.rpc, context.chainId), rpcBlock(context.rpc, "latest")]);
  const included = includedRaw.block;
  if (included.hash !== blockHash || !Array.isArray(includedRaw.raw.transactions) || includedRaw.raw.transactions.length > 20_000 ||
    transactionIndex >= BigInt(includedRaw.raw.transactions.length) ||
    rpcHex(includedRaw.raw.transactions[Number(transactionIndex)], 32, 32) !== transactionHash) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_canonical_transaction_membership");
  }
  const outer = gaslessOuterTransaction(transaction, context.chainId, transactionHash);
  if (outer.to !== intent.entryPoint || outer.valueAtomic !== "0" || outer.from === intent.owner.address ||
    rpcAddress(receipt.from) !== outer.from || rpcAddress(receipt.to) !== outer.to) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_outer_identity");
  }
  const logs = parseReceiptLogs(receipt.logs, transactionHash, included, transactionIndex);
  const status = rpcQuantity(receipt.status);
  if (status !== 0n && status !== 1n) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_status");
  const anchored: GaslessCursor = parentRaw === null ? initialCursor(cursor.startBlock)
    : { startBlock: cursor.startBlock, nextBlockAtomic: included.numberAtomic, previousEndBlock: parentRaw.block };
  if (status === 0n) return unresolved(anchored, transactionHash, "gasless_receipt_unresolved",
    hashObject({ transactionHash, included, outer, status: "outer_reverted" }));
  const safe = safeRaw.block, latest = latestRaw.block;
  if (BigInt(latest.numberAtomic) < BigInt(safe.numberAtomic) || BigInt(latest.timestampAtomic) < BigInt(safe.timestampAtomic)) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_head_behind_safe");
  }
  // Not yet safe: retry later, never a verdict.
  if (BigInt(safe.numberAtomic) < blockNumber) {
    return { status: "pending", transactionHash, settlement: null, cursor: anchored,
      evidenceHash: hashObject({ transactionHash, included, outer, receiptHash: receiptHash(context.chainId,
        transactionHash, included, status, logs) }), reason: null };
  }
  const protocolReceipt: GaslessProtocolReceipt = { chainId: context.chainId, transactionHash, block: included, logs };
  const accounting = gaslessAccounting(intent, userOperationHash, protocolReceipt);
  const [account, again] = await Promise.all([
    readAccountAt(context.rpc, gaslessObservedContracts(intent), intent.owner.address, latest, true),
    rpcBlock(context.rpc, quantity(blockNumber)),
  ]);
  // The anchor: the inclusion block is still canonical at its height (header read); a mismatch is a reorg, no verdict.
  if (!sameBlock(again.block, included)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
  const transactionProofHash = hashObject({ chainId: context.chainId, transactionHash, block: included,
    transactionIndexAtomic: transactionIndex.toString(), outer });
  // Both account fields are the one latest-head read at `accountBlock`; the effect itself is the receipt.
  const settlement = { chainId: context.chainId, userOperationHash, transactionHash, block: included, safeBlock: safe,
    outerSender: outer.from, transactionProofHash, receiptHash: receiptHash(context.chainId, transactionHash, included, status, logs),
    protocolHash: intent.initialSnapshot.protocolHash, effectAccount: account, safeAccount: account, accountBlock: latest, accounting };
  return { status: "safe", transactionHash, settlement, cursor: anchored, evidenceHash: hashObject(settlement), reason: null };
}

async function bundlerCandidate(context: GaslessObservationContext, intent: GaslessIntent,
  userOperationHash: Hex): Promise<Hex | null> {
  if (context.bundler === undefined) return null;
  const settled = await Promise.allSettled([
    context.bundler("eth_getUserOperationReceipt", [userOperationHash]),
    context.bundler("eth_getUserOperationByHash", [userOperationHash]),
  ]);
  const candidates = new Set<Hex>();
  for (const result of settled) {
    if (result.status !== "fulfilled" || result.value === null) continue;
    try {
      const row = rpcRecord(result.value);
      if (row.userOpHash !== undefined && rpcHex(row.userOpHash, 32, 32) !== userOperationHash) continue;
      if (row.entryPoint !== undefined && rpcAddress(row.entryPoint) !== intent.entryPoint) continue;
      let hash: unknown = row.transactionHash;
      if (hash === undefined && row.receipt !== undefined) hash = rpcRecord(row.receipt).transactionHash;
      if (hash !== undefined && hash !== null) candidates.add(rpcHex(hash, 32, 32));
    } catch { /* Ignore malformed locator hints and use the canonical scan. */ }
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}

function validateCursor(intent: GaslessIntent, value: GaslessCursor): GaslessCursor {
  const cursor = gaslessExact(value, ["startBlock", "nextBlockAtomic", "previousEndBlock"], "APN_STATE_CORRUPT") as unknown as GaslessCursor;
  const start = validateBlock(cursor.startBlock), next = gaslessUint(cursor.nextBlockAtomic, false, "APN_STATE_CORRUPT");
  if (!sameBlock(start, intent.initialSnapshot.block) || next < BigInt(start.numberAtomic)) cursorFailure();
  if (cursor.previousEndBlock === null) {
    if (next !== BigInt(start.numberAtomic)) cursorFailure();
  } else {
    const previous = validateBlock(cursor.previousEndBlock), number = BigInt(previous.numberAtomic);
    if (number < BigInt(start.numberAtomic) || next !== number + 1n) cursorFailure();
  }
  return cursor;
}

function validateBlock(value: GaslessBlock): GaslessBlock {
  const block = gaslessExact(value, ["numberAtomic", "hash", "timestampAtomic"], "APN_STATE_CORRUPT") as unknown as GaslessBlock;
  gaslessUint(block.numberAtomic, false, "APN_STATE_CORRUPT"); gaslessUint(block.timestampAtomic, false, "APN_STATE_CORRUPT");
  if (gaslessHex(block.hash, 32, 32, "APN_STATE_CORRUPT") !== block.hash || block.hash === ZERO_HASH) cursorFailure();
  return block;
}

function validateIdentity(identity: GaslessEffectIdentity): void {
  const value = gaslessExact(identity, ["bootstrapMaterialHash", "userOperationMaterialHash", "userOperationHash"], "APN_STATE_CORRUPT");
  for (const field of [value.bootstrapMaterialHash, value.userOperationMaterialHash]) {
    if (field !== null && (typeof field !== "string" || !/^[a-f0-9]{64}$/u.test(field))) cursorFailure();
  }
  if (value.userOperationHash === null) {
    if (value.userOperationMaterialHash !== null) cursorFailure();
  } else if (value.userOperationMaterialHash === null || gaslessHex(value.userOperationHash, 32, 32, "APN_STATE_CORRUPT") !== value.userOperationHash) {
    cursorFailure();
  }
}

function initialCursor(startBlock: GaslessBlock): GaslessCursor {
  return { startBlock, nextBlockAtomic: startBlock.numberAtomic, previousEndBlock: null };
}
function unresolved(cursor: GaslessCursor, transactionHash: Hex | null, reason: string,
  evidenceHash: string | null): GaslessObservation {
  return { status: "unresolved", transactionHash, settlement: null, cursor, evidenceHash, reason };
}
function cursorFailure(): never { return gaslessFailure("APN_STATE_CORRUPT", "gasless_receipt_unresolved"); }
function minimum(left: bigint, right: bigint): bigint { return left < right ? left : right; }
