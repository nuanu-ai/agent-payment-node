import { hashObject } from "../canonical.js";
import { gaslessAccounting } from "./protocol.js";
import { observeGaslessBootstrap } from "./rpc-bootstrap-observe.js";
import { GASLESS_LOG_REQUEST_BLOCKS, GASLESS_SCAN_WINDOW_BLOCKS, GASLESS_SCAN_WINDOWS } from "./rpc-budget.js";
import { addressWord, parseReceiptLogs, quantity, receiptHash, rpcAddress, rpcBlock, rpcFinalityBlock, rpcHex, rpcQuantity, rpcRecord, sameBlock } from "./rpc-codec.js";
import { gaslessObservedContracts, readAccountAt } from "./rpc-state.js";
import { gaslessOuterTransaction } from "./rpc-transaction.js";
import { gaslessExact, gaslessFailure, gaslessHex, gaslessUint } from "./validation.js";
const USER_OPERATION_EVENT = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";
const ZERO_HASH = `0x${"0".repeat(64)}`;
/**
 * Archive-free observation. Effects are proven by the authenticated receipt logs and header membership; account state
 * is read only at the current safe (Polygon: finalized) head and at the latest head, never at the prepare, inclusion or
 * scan-cursor block, whose state a keyless node with a ~128-block state window no longer serves.
 */
export async function observeGasless(context, intent, identity, cursorInput) {
    const cursor = validateCursor(intent, cursorInput);
    validateIdentity(identity);
    if (identity.userOperationHash === null) {
        return await observeGaslessBootstrap(context, intent, identity, cursor);
    }
    const userOperationHash = identity.userOperationHash;
    let candidate = null;
    try {
        candidate = await bundlerCandidate(context, intent, userOperationHash);
    }
    catch { /* A locator is never authoritative; canonical EntryPoint scanning follows. */ }
    if (candidate !== null)
        return await inspectSafely(context, intent, userOperationHash, candidate, cursor);
    const scanned = await scan(context, intent, userOperationHash, cursor);
    // The invalidation probe runs only once the canonical scan reached the current safe head, and reads state there.
    if (scanned.observation.status === "not_found" && scanned.reachedSafe !== null) {
        const invalidation = await observeGaslessBootstrap(context, intent, identity, scanned.observation.cursor, scanned.reachedSafe);
        if (invalidation.status === "permissions_invalidated")
            return invalidation;
    }
    return scanned.observation;
}
/**
 * Up to `GASLESS_SCAN_WINDOWS` windows per step, each one request: the window's end header and its bounded log ranges.
 * Every scanned block is at or below the safe head, which does not reorganise, so no header is re-read after the logs.
 */
async function scan(context, intent, userOperationHash, input) {
    let cursor = input;
    try {
        const previousNumber = cursor.previousEndBlock === null ? null : quantity(BigInt(cursor.previousEndBlock.numberAtomic));
        const [safeRaw, previous] = await Promise.all([rpcFinalityBlock(context.rpc, context.chainId),
            previousNumber === null ? Promise.resolve(null) : rpcBlock(context.rpc, previousNumber)]);
        if (previous !== null && !sameBlock(previous.block, cursor.previousEndBlock)) {
            return { reachedSafe: null, observation: unresolved(initialCursor(cursor.startBlock), null, "gasless_receipt_unresolved", hashObject({ reason: "gasless_scan_cursor_reorg", previous: cursor.previousEndBlock, current: previous.block })) };
        }
        const safe = safeRaw.block, safeNumber = BigInt(safe.numberAtomic);
        const filter = { address: intent.entryPoint,
            topics: [USER_OPERATION_EVENT, userOperationHash, addressWord(intent.owner.address), addressWord(intent.paymaster)] };
        const scannedFrom = BigInt(cursor.nextBlockAtomic);
        for (let window = 0; window < GASLESS_SCAN_WINDOWS && BigInt(cursor.nextBlockAtomic) <= safeNumber; window += 1) {
            const start = BigInt(cursor.nextBlockAtomic), end = minimum(safeNumber, start + GASLESS_SCAN_WINDOW_BLOCKS - 1n);
            const ranges = [];
            for (let from = start; from <= end; from += GASLESS_LOG_REQUEST_BLOCKS) {
                ranges.push({ from, to: minimum(end, from + GASLESS_LOG_REQUEST_BLOCKS - 1n) });
            }
            const [endRaw, ...values] = await Promise.all([rpcBlock(context.rpc, quantity(end)),
                ...ranges.map(({ from, to }) => context.rpc("eth_getLogs", [{ ...filter, fromBlock: quantity(from), toBlock: quantity(to) }]))]);
            const candidates = scanLogs(intent, userOperationHash, ranges, values);
            if (candidates.size > 1) {
                return { reachedSafe: null, observation: unresolved(cursor, null, "gasless_receipt_unresolved", hashObject({ filter, from: start.toString(), to: end.toString(), count: candidates.size })) };
            }
            const candidate = [...candidates][0];
            if (candidate !== undefined) {
                return { reachedSafe: null, observation: await inspectSafely(context, intent, userOperationHash, candidate, cursor) };
            }
            cursor = { startBlock: cursor.startBlock, nextBlockAtomic: (end + 1n).toString(), previousEndBlock: endRaw.block };
        }
        const reached = BigInt(cursor.nextBlockAtomic) > safeNumber && cursor.previousEndBlock !== null &&
            sameBlock(cursor.previousEndBlock, safe);
        return { reachedSafe: reached ? safe : null, observation: { status: "not_found", transactionHash: null, settlement: null,
                cursor, evidenceHash: hashObject({ userOperationHash, from: scannedFrom.toString(), cursor, safe }), reason: null } };
    }
    catch {
        return { reachedSafe: null, observation: unresolved(cursor, null, "gasless_receipt_unresolved", null) };
    }
}
function scanLogs(intent, userOperationHash, ranges, values) {
    const candidates = new Set();
    let logCount = 0;
    for (let index = 0; index < ranges.length; index += 1) {
        const { from, to } = ranges[index], value = values[index];
        if (!Array.isArray(value) || value.length > 128 - logCount)
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_scan_log_count");
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
            rpcHex(log.blockHash, 32, 32);
            rpcQuantity(log.logIndex);
            rpcHex(log.data, 256);
            candidates.add(rpcHex(log.transactionHash, 32, 32));
        }
    }
    return candidates;
}
async function inspectSafely(context, intent, userOperationHash, transactionHash, cursor) {
    try {
        return await inspect(context, intent, userOperationHash, transactionHash, cursor);
    }
    catch {
        return unresolved(cursor, null, "gasless_receipt_unresolved", null);
    }
}
/**
 * Three requests: the transaction and its receipt; the inclusion header (with its transaction list), its parent (the
 * cursor anchor) and the safe head; then, once safe covers the inclusion, the account at the safe head together with
 * the inclusion header read again. Every success fact is in the receipt logs (UserOperationEvent, permit, transfers,
 * cleanup Approval(0)); the account read only records the residual allowance and the consumed nonces at a safe block.
 */
async function inspect(context, intent, userOperationHash, transactionHash, cursor) {
    const [rawTransaction, rawReceipt] = await Promise.all([
        context.rpc("eth_getTransactionByHash", [transactionHash]),
        context.rpc("eth_getTransactionReceipt", [transactionHash]),
    ]);
    if (rawTransaction === null && rawReceipt === null) {
        return { status: "pending", transactionHash, settlement: null, cursor,
            evidenceHash: hashObject({ transactionHash, status: "pending" }), reason: null };
    }
    if (rawTransaction === null || rawReceipt === null)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_unresolved");
    const transaction = rpcRecord(rawTransaction), receipt = rpcRecord(rawReceipt);
    const blockNumber = rpcQuantity(receipt.blockNumber), blockHash = rpcHex(receipt.blockHash, 32, 32);
    const transactionIndex = rpcQuantity(receipt.transactionIndex), type = rpcQuantity(receipt.type);
    if (rpcHex(receipt.transactionHash, 32, 32) !== transactionHash || rpcHex(transaction.blockHash, 32, 32) !== blockHash ||
        rpcQuantity(transaction.blockNumber) !== blockNumber || rpcQuantity(transaction.transactionIndex) !== transactionIndex ||
        rpcQuantity(transaction.type) !== type)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_transaction_membership");
    const start = BigInt(cursor.startBlock.numberAtomic);
    if (blockNumber < start)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_before_prepare");
    const [includedRaw, parentRaw, safeRaw] = await Promise.all([rpcBlock(context.rpc, quantity(blockNumber)),
        blockNumber === start ? Promise.resolve(null) : rpcBlock(context.rpc, quantity(blockNumber - 1n)),
        rpcFinalityBlock(context.rpc, context.chainId)]);
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
    if (status !== 0n && status !== 1n)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_status");
    const anchored = parentRaw === null ? initialCursor(cursor.startBlock)
        : { startBlock: cursor.startBlock, nextBlockAtomic: included.numberAtomic, previousEndBlock: parentRaw.block };
    if (status === 0n)
        return unresolved(anchored, transactionHash, "gasless_receipt_unresolved", hashObject({ transactionHash, included, outer, status: "outer_reverted" }));
    const safe = safeRaw.block;
    if (BigInt(safe.numberAtomic) < blockNumber) {
        return { status: "pending", transactionHash, settlement: null, cursor: anchored,
            evidenceHash: hashObject({ transactionHash, included, outer, receiptHash: receiptHash(context.chainId, transactionHash, included, status, logs) }), reason: null };
    }
    const protocolReceipt = { chainId: context.chainId, transactionHash, block: included, logs };
    const accounting = gaslessAccounting(intent, userOperationHash, protocolReceipt);
    const [safeAccount, again] = await Promise.all([
        readAccountAt(context.rpc, gaslessObservedContracts(intent), intent.owner.address, safe, true),
        rpcBlock(context.rpc, quantity(blockNumber)),
    ]);
    if (!sameBlock(again.block, included))
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
    const transactionProofHash = hashObject({ chainId: context.chainId, transactionHash, block: included,
        transactionIndexAtomic: transactionIndex.toString(), outer });
    // `effectAccount` is the same safe-head read: nonces only grow, so it shows them consumed; the effect itself is the receipt.
    const settlement = { chainId: context.chainId, userOperationHash, transactionHash, block: included, safeBlock: safe,
        outerSender: outer.from, transactionProofHash, receiptHash: receiptHash(context.chainId, transactionHash, included, status, logs),
        protocolHash: intent.initialSnapshot.protocolHash, effectAccount: safeAccount, safeAccount, accounting };
    return { status: "safe", transactionHash, settlement, cursor: anchored, evidenceHash: hashObject(settlement), reason: null };
}
async function bundlerCandidate(context, intent, userOperationHash) {
    if (context.bundler === undefined)
        return null;
    const settled = await Promise.allSettled([
        context.bundler("eth_getUserOperationReceipt", [userOperationHash]),
        context.bundler("eth_getUserOperationByHash", [userOperationHash]),
    ]);
    const candidates = new Set();
    for (const result of settled) {
        if (result.status !== "fulfilled" || result.value === null)
            continue;
        try {
            const row = rpcRecord(result.value);
            if (row.userOpHash !== undefined && rpcHex(row.userOpHash, 32, 32) !== userOperationHash)
                continue;
            if (row.entryPoint !== undefined && rpcAddress(row.entryPoint) !== intent.entryPoint)
                continue;
            let hash = row.transactionHash;
            if (hash === undefined && row.receipt !== undefined)
                hash = rpcRecord(row.receipt).transactionHash;
            if (hash !== undefined && hash !== null)
                candidates.add(rpcHex(hash, 32, 32));
        }
        catch { /* Ignore malformed locator hints and use the canonical scan. */ }
    }
    return candidates.size === 1 ? [...candidates][0] : null;
}
function validateCursor(intent, value) {
    const cursor = gaslessExact(value, ["startBlock", "nextBlockAtomic", "previousEndBlock"], "APN_STATE_CORRUPT");
    const start = validateBlock(cursor.startBlock), next = gaslessUint(cursor.nextBlockAtomic, false, "APN_STATE_CORRUPT");
    if (!sameBlock(start, intent.initialSnapshot.block) || next < BigInt(start.numberAtomic))
        cursorFailure();
    if (cursor.previousEndBlock === null) {
        if (next !== BigInt(start.numberAtomic))
            cursorFailure();
    }
    else {
        const previous = validateBlock(cursor.previousEndBlock), number = BigInt(previous.numberAtomic);
        if (number < BigInt(start.numberAtomic) || next !== number + 1n)
            cursorFailure();
    }
    return cursor;
}
function validateBlock(value) {
    const block = gaslessExact(value, ["numberAtomic", "hash", "timestampAtomic"], "APN_STATE_CORRUPT");
    gaslessUint(block.numberAtomic, false, "APN_STATE_CORRUPT");
    gaslessUint(block.timestampAtomic, false, "APN_STATE_CORRUPT");
    if (gaslessHex(block.hash, 32, 32, "APN_STATE_CORRUPT") !== block.hash || block.hash === ZERO_HASH)
        cursorFailure();
    return block;
}
function validateIdentity(identity) {
    const value = gaslessExact(identity, ["bootstrapMaterialHash", "userOperationMaterialHash", "userOperationHash"], "APN_STATE_CORRUPT");
    for (const field of [value.bootstrapMaterialHash, value.userOperationMaterialHash]) {
        if (field !== null && (typeof field !== "string" || !/^[a-f0-9]{64}$/u.test(field)))
            cursorFailure();
    }
    if (value.userOperationHash === null) {
        if (value.userOperationMaterialHash !== null)
            cursorFailure();
    }
    else if (value.userOperationMaterialHash === null || gaslessHex(value.userOperationHash, 32, 32, "APN_STATE_CORRUPT") !== value.userOperationHash) {
        cursorFailure();
    }
}
function initialCursor(startBlock) {
    return { startBlock, nextBlockAtomic: startBlock.numberAtomic, previousEndBlock: null };
}
function unresolved(cursor, transactionHash, reason, evidenceHash) {
    return { status: "unresolved", transactionHash, settlement: null, cursor, evidenceHash, reason };
}
function cursorFailure() { return gaslessFailure("APN_STATE_CORRUPT", "gasless_receipt_unresolved"); }
function minimum(left, right) { return left < right ? left : right; }
//# sourceMappingURL=rpc-observe.js.map