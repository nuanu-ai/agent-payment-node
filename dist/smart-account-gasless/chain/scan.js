import { hashObject } from "../../canonical.js";
import { saFail } from "../reasons.js";
import { saBlock } from "../schema.js";
import { saRegistry } from "../registry.js";
import { SA_INCREASED_SPENT_TOPIC, SA_TRANSFER_TOPIC, SaRpcBudgetError, SaRpcRangeError, SaRpcReorgError, SaScanLimitError, addressWord, quantity, recheckBlock, rpcBlock, rpcRecord, sameBlock } from "./abi.js";
import { rpcQuantity } from "./abi.js";
import { verifyChildScanLog, verifyTransferScanLog } from "./receipt.js";
export const SA_SCAN_RANGE = 1999n;
export const SA_SCAN_LOG_LIMIT = 128;
export const SA_SCAN_CANDIDATE_LIMIT = 8;
export function initialSmartAccountGaslessCursor(intent) {
    return { startBlock: intent.initialSnapshot.preparationBlock,
        nextBlockAtomic: intent.initialSnapshot.preparationBlock.numberAtomic, previousEndBlock: null,
        expiryBlock: null, candidateHashes: [], transferAnomalies: [], childScanComplete: false,
        transferScanComplete: false };
}
export function validateSmartAccountGaslessCursor(intent, cursor) {
    const start = saBlock(cursor.startBlock), expected = intent.initialSnapshot.preparationBlock;
    if (!sameBlock(start, expected))
        saFail("sa_gasless_state_corrupt");
    if (typeof cursor.nextBlockAtomic !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(cursor.nextBlockAtomic)) {
        saFail("sa_gasless_state_corrupt");
    }
    const next = BigInt(cursor.nextBlockAtomic), startNumber = BigInt(start.numberAtomic);
    if (next < startNumber || !Array.isArray(cursor.candidateHashes) || !Array.isArray(cursor.transferAnomalies) ||
        cursor.candidateHashes.length > SA_SCAN_CANDIDATE_LIMIT || cursor.transferAnomalies.length > SA_SCAN_CANDIDATE_LIMIT ||
        new Set(cursor.candidateHashes).size !== cursor.candidateHashes.length ||
        new Set(cursor.transferAnomalies).size !== cursor.transferAnomalies.length)
        saFail("sa_gasless_state_corrupt");
    for (const hash of [...cursor.candidateHashes, ...cursor.transferAnomalies]) {
        if (!/^0x[0-9a-f]{64}$/u.test(hash))
            saFail("sa_gasless_state_corrupt");
    }
    if (cursor.previousEndBlock === null) {
        if (next !== startNumber)
            saFail("sa_gasless_state_corrupt");
    }
    else {
        const previous = saBlock(cursor.previousEndBlock);
        if (BigInt(previous.numberAtomic) + 1n !== next || BigInt(previous.numberAtomic) < startNumber) {
            saFail("sa_gasless_state_corrupt");
        }
    }
    const expiry = cursor.expiryBlock === null ? null : saBlock(cursor.expiryBlock);
    if (expiry !== null && (BigInt(expiry.numberAtomic) < startNumber || BigInt(expiry.timestampAtomic) < BigInt(intent.beforeUnix))) {
        saFail("sa_gasless_state_corrupt");
    }
    const complete = expiry !== null && next > BigInt(expiry.numberAtomic);
    if (cursor.childScanComplete !== cursor.transferScanComplete || cursor.childScanComplete !== complete) {
        saFail("sa_gasless_state_corrupt");
    }
    return { ...cursor, startBlock: start, previousEndBlock: cursor.previousEndBlock === null ? null : saBlock(cursor.previousEndBlock),
        expiryBlock: expiry };
}
/** Advance both exact-child and conservative transfer scans over one fully checked range. */
export async function advanceSmartAccountGaslessScan(call, intent, childHash, cursorInput, safeHead) {
    const cursor = validateSmartAccountGaslessCursor(intent, cursorInput);
    try {
        await recheckBlock(call, cursor.startBlock, "sa_gasless_evidence", true);
        if (cursor.previousEndBlock !== null)
            await recheckBlock(call, cursor.previousEndBlock, "sa_gasless_evidence", true);
        if (cursor.previousEndBlock !== null &&
            BigInt(safeHead.numberAtomic) < BigInt(cursor.previousEndBlock.numberAtomic))
            throw new SaRpcReorgError();
        let expiry = cursor.expiryBlock;
        if (expiry !== null)
            await recheckBlock(call, expiry, "sa_gasless_evidence", true);
        if (BigInt(safeHead.numberAtomic) < BigInt(cursor.startBlock.numberAtomic))
            saFail("sa_gasless_evidence");
        if (expiry === null && BigInt(safeHead.timestampAtomic) >= BigInt(intent.beforeUnix)) {
            expiry = await findExpiryBlock(call, cursor.startBlock, safeHead, BigInt(intent.beforeUnix));
        }
        const next = BigInt(cursor.nextBlockAtomic);
        const last = expiry === null ? BigInt(safeHead.numberAtomic) : minimum(BigInt(safeHead.numberAtomic), BigInt(expiry.numberAtomic));
        if (next > last) {
            await recheckBlock(call, safeHead, "sa_gasless_evidence", true);
            if (expiry !== null)
                await recheckBlock(call, expiry, "sa_gasless_evidence", true);
            const complete = expiry !== null && next > BigInt(expiry.numberAtomic);
            const unchanged = { ...cursor, expiryBlock: expiry, childScanComplete: complete, transferScanComplete: complete };
            return { cursor: unchanged, partial: false, evidenceHash: hashObject({ cursor: unchanged, safeHead, empty: true }) };
        }
        let span = minimum(SA_SCAN_RANGE, last - next + 1n);
        while (span >= 1n) {
            const end = next + span - 1n;
            try {
                const progressed = await scanRange(call, intent, childHash, cursor, expiry, safeHead, next, end);
                return { cursor: progressed, partial: false, evidenceHash: hashObject({ cursor: progressed, safeHead }) };
            }
            catch (error) {
                if (!(error instanceof SaRpcRangeError))
                    throw error;
                if (span === 1n)
                    throw new SaScanLimitError();
                span = maximum(1n, span / 2n);
            }
        }
        throw new SaScanLimitError();
    }
    catch (error) {
        if (error instanceof SaRpcBudgetError || error instanceof SaScanLimitError) {
            return { cursor, partial: true, evidenceHash: hashObject({ cursor, partial: true }) };
        }
        throw error;
    }
}
async function scanRange(call, intent, childHash, cursor, expiry, safeHead, start, end) {
    const [startBlock, endBlock] = await Promise.all([
        rpcBlock(call, quantity(start)).then(result => result.block),
        rpcBlock(call, quantity(end)).then(result => result.block),
    ]);
    const registry = saRegistry(8453), facilitator = intent.provider.facilitatorAddresses[0];
    const childFilter = { address: registry.protocol.amount.address, fromBlock: quantity(start), toBlock: quantity(end),
        topics: [SA_INCREASED_SPENT_TOPIC, addressWord(registry.protocol.manager.address), addressWord(facilitator),
            childHash] };
    const transferFilter = { address: registry.token.address, fromBlock: quantity(start), toBlock: quantity(end),
        topics: [SA_TRANSFER_TOPIC, addressWord(intent.binding.ownerAddress), addressWord(intent.request.recipient)] };
    const childRaw = await call("eth_getLogs", [childFilter]);
    const transferRaw = await call("eth_getLogs", [transferFilter]);
    if (!Array.isArray(childRaw) || !Array.isArray(transferRaw) || childRaw.length > SA_SCAN_LOG_LIMIT ||
        transferRaw.length > SA_SCAN_LOG_LIMIT)
        throw new SaScanLimitError();
    const additions = [], transfers = [];
    for (const value of canonicalScanRecords(childRaw)) {
        additions.push(verifyChildScanLog(value, intent, childHash, start, end));
    }
    for (const value of canonicalScanRecords(transferRaw)) {
        const hash = verifyTransferScanLog(value, intent, start, end);
        if (hash !== null)
            transfers.push(hash);
    }
    const candidateHashes = append(cursor.candidateHashes, additions);
    const transferAnomalies = append(cursor.transferAnomalies, transfers);
    if (candidateHashes.length > SA_SCAN_CANDIDATE_LIMIT || transferAnomalies.length > SA_SCAN_CANDIDATE_LIMIT) {
        throw new SaScanLimitError();
    }
    await recheckBlock(call, startBlock, "sa_gasless_evidence", true);
    await recheckBlock(call, endBlock, "sa_gasless_evidence", true);
    await recheckBlock(call, safeHead, "sa_gasless_evidence", true);
    if (expiry !== null)
        await recheckBlock(call, expiry, "sa_gasless_evidence", true);
    const next = end + 1n, complete = expiry !== null && next > BigInt(expiry.numberAtomic);
    return { startBlock: cursor.startBlock, nextBlockAtomic: next.toString(), previousEndBlock: endBlock,
        expiryBlock: expiry, candidateHashes, transferAnomalies, childScanComplete: complete, transferScanComplete: complete };
}
function canonicalScanRecords(values) {
    const records = [];
    let previous = null;
    for (const value of values) {
        const record = rpcRecord(value), position = [rpcQuantity(record.blockNumber),
            rpcQuantity(record.transactionIndex), rpcQuantity(record.logIndex)];
        if (previous !== null && comparePosition(position, previous) <= 0)
            saFail("sa_gasless_evidence");
        previous = position;
        records.push(record);
    }
    return records;
}
function comparePosition(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] < right[index])
            return -1;
        if (left[index] > right[index])
            return 1;
    }
    return 0;
}
async function findExpiryBlock(call, start, head, threshold) {
    let low = BigInt(start.numberAtomic), high = BigInt(head.numberAtomic), answer = head;
    if (BigInt(start.timestampAtomic) >= threshold)
        return start;
    while (low <= high) {
        const middle = (low + high) / 2n, block = (await rpcBlock(call, quantity(middle))).block;
        if (BigInt(block.timestampAtomic) >= threshold) {
            answer = block;
            high = middle - 1n;
        }
        else
            low = middle + 1n;
    }
    await recheckBlock(call, answer, "sa_gasless_evidence", true);
    if (BigInt(answer.timestampAtomic) < threshold)
        saFail("sa_gasless_evidence");
    if (BigInt(answer.numberAtomic) > BigInt(start.numberAtomic)) {
        const prior = (await rpcBlock(call, quantity(BigInt(answer.numberAtomic) - 1n))).block;
        if (BigInt(prior.timestampAtomic) >= threshold)
            saFail("sa_gasless_evidence");
        await recheckBlock(call, prior, "sa_gasless_evidence", true);
    }
    return answer;
}
function append(existing, values) {
    const result = [...existing];
    for (const value of values)
        if (!result.includes(value))
            result.push(value);
    return result;
}
function minimum(left, right) { return left < right ? left : right; }
function maximum(left, right) { return left > right ? left : right; }
//# sourceMappingURL=scan.js.map