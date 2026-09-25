import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { GaslessBlock, GaslessChainId, GaslessCursor, GaslessDeployment, GaslessEffectIdentity,
  GaslessIntent, GaslessObservation, GaslessProtocolReceipt, GaslessSnapshot } from "./model.js";
import { gaslessAccounting } from "./protocol.js";
import { observeGaslessBootstrap } from "./rpc-bootstrap-observe.js";
import { addressWord, parseReceiptLogs, quantity, receiptHash, recheckBlock, rpcAddress, rpcBlock, rpcFinalityBlock, rpcHex,
  rpcQuantity, rpcRecord, sameBlock, type GaslessRpcCall } from "./rpc-codec.js";
import { readAccountAt, verifyProtocolAt } from "./rpc-state.js";
import { verifyGaslessOuterTransaction } from "./rpc-transaction.js";
import { gaslessProtocolHash } from "./registry.js";
import { gaslessAddress, gaslessExact, gaslessFailure, gaslessHex, gaslessUint } from "./validation.js";

const USER_OPERATION_EVENT =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" as Hex;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const SCAN_WINDOW = 256n;
const LOG_REQUEST_WINDOW = 10n;

export interface GaslessObservationContext {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly deployment: GaslessDeployment;
  readonly rpc: GaslessRpcCall;
  readonly bundler?: GaslessRpcCall;
  /** Retained for existing callers; canonical observation never uses an execution snapshot. */
  readonly snapshot?: (owner: Address) => Promise<GaslessSnapshot>;
}

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
  if (scanned.status === "not_found") {
    const invalidation = await observeGaslessBootstrap(context, intent, identity, scanned.cursor);
    if (invalidation.status === "permissions_invalidated") return invalidation;
  }
  return scanned;
}

async function scan(context: GaslessObservationContext, intent: GaslessIntent, userOperationHash: Hex,
  cursor: GaslessCursor): Promise<GaslessObservation> {
  try {
    if (cursor.previousEndBlock !== null) {
      const current = (await rpcBlock(context.rpc, quantity(BigInt(cursor.previousEndBlock.numberAtomic)))).block;
      if (!sameBlock(current, cursor.previousEndBlock)) {
        const reset = initialCursor(cursor.startBlock);
        return unresolved(reset, null, "gasless_receipt_unresolved",
          hashObject({ reason: "gasless_scan_cursor_reorg", previous: cursor.previousEndBlock, current }));
      }
    }
    const safe = (await rpcFinalityBlock(context.rpc, context.chainId)).block;
    const start = BigInt(cursor.nextBlockAtomic), safeNumber = BigInt(safe.numberAtomic);
    if (safeNumber < start) {
      await recheckBlock(context.rpc, safe);
      return { status: "not_found", transactionHash: null, settlement: null, cursor,
        evidenceHash: hashObject({ userOperationHash, cursor, safe }), reason: null };
    }
    const end = minimum(safeNumber, start + SCAN_WINDOW - 1n);
    const endBlock = (await rpcBlock(context.rpc, quantity(end))).block;
    const filter = { address: intent.entryPoint, fromBlock: quantity(start), toBlock: quantity(end),
      topics: [USER_OPERATION_EVENT, userOperationHash, addressWord(intent.owner.address), addressWord(intent.paymaster)] };
    const candidates = new Set<Hex>(); let logCount = 0;
    // Keep one bounded cursor step while supporting public RPC range limits.
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    for (let from = start; from <= end; from += LOG_REQUEST_WINDOW) {
      const to = minimum(end, from + LOG_REQUEST_WINDOW - 1n);
      ranges.push({ from, to });
    }
    // Each range remains bounded to ten blocks; read-only JSON-RPC batching keeps a 256-block scan within one POST.
    const values = await Promise.all(ranges.map(({ from, to }) => context.rpc("eth_getLogs",
      [{ ...filter, fromBlock: quantity(from), toBlock: quantity(to) }])));
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
    await recheckBlock(context.rpc, endBlock); await recheckBlock(context.rpc, safe);
    if (candidates.size > 1) return unresolved(cursor, null, "gasless_receipt_unresolved", hashObject({ filter, count: candidates.size }));
    const candidate = [...candidates][0];
    if (candidate !== undefined) return await inspectSafely(context, intent, userOperationHash, candidate, cursor);
    const nextCursor = { startBlock: cursor.startBlock, nextBlockAtomic: (end + 1n).toString(), previousEndBlock: endBlock };
    return { status: "not_found", transactionHash: null, settlement: null, cursor: nextCursor,
      evidenceHash: hashObject({ userOperationHash, from: start.toString(), to: end.toString(), endBlock, safe }), reason: null };
  } catch {
    return unresolved(cursor, null, "gasless_receipt_unresolved", null);
  }
}

async function inspectSafely(context: GaslessObservationContext, intent: GaslessIntent, userOperationHash: Hex,
  transactionHash: Hex, cursor: GaslessCursor): Promise<GaslessObservation> {
  try { return await inspect(context, intent, userOperationHash, transactionHash, cursor); }
  catch { return unresolved(cursor, null, "gasless_receipt_unresolved", null); }
}

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
  const includedRaw = await rpcBlock(context.rpc, quantity(blockNumber)), included = includedRaw.block;
  if (included.hash !== blockHash || !Array.isArray(includedRaw.raw.transactions) || includedRaw.raw.transactions.length > 20_000 ||
    transactionIndex >= BigInt(includedRaw.raw.transactions.length) ||
    rpcHex(includedRaw.raw.transactions[Number(transactionIndex)], 32, 32) !== transactionHash) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_canonical_transaction_membership");
  }
  const outer = await verifyGaslessOuterTransaction(transaction, context.chainId, transactionHash);
  if (outer.to !== intent.entryPoint || outer.valueAtomic !== "0" || outer.from === intent.owner.address ||
    rpcAddress(receipt.from) !== outer.from || rpcAddress(receipt.to) !== outer.to) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_outer_identity");
  }
  const logs = parseReceiptLogs(receipt.logs, transactionHash, included, transactionIndex);
  const status = rpcQuantity(receipt.status);
  if (status !== 0n && status !== 1n) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_status");
  const anchored = await anchorCursor(context.rpc, cursor.startBlock, included);
  await recheckBlock(context.rpc, included);
  if (status === 0n) return unresolved(anchored, transactionHash, "gasless_receipt_unresolved",
    hashObject({ transactionHash, included, outer, status: "outer_reverted" }));
  const safe = (await rpcFinalityBlock(context.rpc, context.chainId)).block;
  await recheckBlock(context.rpc, safe);
  if (BigInt(safe.numberAtomic) < blockNumber) {
    return { status: "pending", transactionHash, settlement: null, cursor: anchored,
      evidenceHash: hashObject({ transactionHash, included, outer, receiptHash: receiptHash(context.chainId,
        transactionHash, included, status, logs) }), reason: null };
  }
  const deploymentHash = gaslessProtocolHash(context.deployment);
  const protocolReceipt: GaslessProtocolReceipt = { chainId: context.chainId, transactionHash, block: included, logs };
  const [effectAccount, safeAccount] = await Promise.all([
    readAccountAt(context.rpc, context.deployment, intent.owner.address, included, false),
    readAccountAt(context.rpc, context.deployment, intent.owner.address, safe, true),
    verifyProtocolAt(context.rpc, context.deployment, included),
    verifyProtocolAt(context.rpc, context.deployment, safe),
  ]).then(([effect, current]) => [effect, current] as const);
  const accounting = gaslessAccounting(intent, userOperationHash, protocolReceipt);
  await recheckBlock(context.rpc, included); await recheckBlock(context.rpc, safe);
  const transactionProofHash = hashObject({ chainId: context.chainId, transactionHash, block: included,
    transactionIndexAtomic: transactionIndex.toString(), outer });
  const settlement = { chainId: context.chainId, userOperationHash, transactionHash, block: included, safeBlock: safe,
    outerSender: outer.from, transactionProofHash, receiptHash: receiptHash(context.chainId, transactionHash, included, status, logs),
    protocolHash: deploymentHash, effectAccount, safeAccount, accounting };
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

async function anchorCursor(call: GaslessRpcCall, startBlock: GaslessBlock, included: GaslessBlock): Promise<GaslessCursor> {
  const start = BigInt(startBlock.numberAtomic), number = BigInt(included.numberAtomic);
  if (number < start) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_before_prepare");
  if (number === start) return initialCursor(startBlock);
  const previous = (await rpcBlock(call, quantity(number - 1n))).block;
  await recheckBlock(call, previous);
  return { startBlock, nextBlockAtomic: included.numberAtomic, previousEndBlock: previous };
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
