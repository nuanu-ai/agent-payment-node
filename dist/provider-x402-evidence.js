import { canonicalJson, hashObject, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import { x402Asset } from "./x402-network.js";
import { selectX402Rpc } from "./x402-service-rpc.js";
const MAX_UPPER_READS = 4;
/** Provider evidence is Base USDC: the port is bound to exactly that network and token in every branch that reads it. */
export function providerX402ReadPort(rpc) {
    const value = selectX402Rpc(rpc, x402Asset(8453, BASE_USDC));
    if (typeof value.getX402Head !== "function" || typeof value.getX402Block !== "function" ||
        typeof value.getX402Receipt !== "function" || typeof value.getX402TransferLogs !== "function")
        throw new ApnError("APN_RPC_CONFIG", "Provider x402 requires the bounded read-only Base evidence surface.");
    return value;
}
export async function captureProviderEvidenceLowerBlock(rpc) {
    const identity = await rpc.assertBaseChain();
    if (identity.chainId !== 8453 || identity.rpcOrigin.length === 0)
        throw protocol();
    const lowerBlock = await rpc.getX402Head("safe");
    assertHead(lowerBlock, identity.rpcOrigin);
    return { lowerBlock, rpcOriginHash: sha256(identity.rpcOrigin) };
}
export async function observeProviderSettlement(operation, rpc, nowMs) {
    if (operation.evidenceLowerBlock === undefined || operation.evidenceDeadlineAt === undefined) {
        return { kind: "ambiguous", reason: "provider_evidence_capability_gap" };
    }
    // A safe block is never later than now, so before the evidence deadline no read can close the window.
    if (!Number.isFinite(nowMs) || nowMs < Date.parse(operation.evidenceDeadlineAt))
        return { kind: "pending" };
    let upperBlock = operation.immutableUpperBlock;
    try {
        const identity = await rpc.assertBaseChain();
        if (identity.chainId !== 8453 || identity.rpcOrigin.length === 0)
            throw protocol();
        const safe = await rpc.getX402Head("safe");
        assertHead(safe, identity.rpcOrigin);
        const deadlineSeconds = BigInt(Math.ceil(Date.parse(operation.evidenceDeadlineAt) / 1_000));
        if (BigInt(safe.timestamp) < deadlineSeconds)
            return { kind: "pending" };
        upperBlock = await immutableUpper(operation, rpc, safe, deadlineSeconds, identity.rpcOrigin);
        const logs = await outgoingTransfers(rpc, operation.provider.payer, operation.evidenceLowerBlock.number, upperBlock.number);
        if (logs === null)
            return { kind: "ambiguous", reason: "provider_evidence_capability_gap", upperBlock };
        if (logs.length !== 1)
            return { kind: "ambiguous", reason: "settlement_not_unique", upperBlock };
        const transfer = logs[0];
        if (transfer === undefined || !matchesFrozenTransfer(transfer, operation)) {
            return { kind: "ambiguous", reason: "settlement_mismatch", upperBlock };
        }
        const receipt = await rpc.getX402Receipt(transfer.transactionHash);
        if (receipt === null)
            return { kind: "ambiguous", reason: "settlement_receipt_missing", upperBlock };
        if (receipt.status !== "success" || receipt.transactionHash !== transfer.transactionHash ||
            receipt.blockNumber !== transfer.blockNumber || receipt.blockHash !== transfer.blockHash ||
            receipt.rpcOrigin !== identity.rpcOrigin ||
            !receipt.logs.some((log) => canonicalJson(log) === canonicalJson(transfer)))
            return { kind: "ambiguous", reason: "settlement_receipt_mismatch", upperBlock };
        const transactionBlock = await rpc.getX402Block(receipt.blockNumber);
        assertBlock(transactionBlock, identity.rpcOrigin);
        if (transactionBlock.hash !== receipt.blockHash) {
            return { kind: "ambiguous", reason: "settlement_block_mismatch", upperBlock };
        }
        const base = {
            schemaVersion: "apn.provider-x402.settlement.v1",
            lowerBlock: operation.evidenceLowerBlock,
            upperBlock,
            transactionHash: transfer.transactionHash,
            receiptStatus: "success",
            transfer,
            chainId: "8453",
            network: CHAIN_CAIP2,
            token: BASE_USDC.toLowerCase(),
            payer: operation.provider.payer,
            payee: operation.requirement.payee,
            amountAtomic: operation.requirement.amountAtomic,
            rpcOriginHash: sha256(identity.rpcOrigin),
        };
        return { kind: "verified", upperBlock, evidence: { ...base, evidenceHash: hashObject(base) } };
    }
    catch (error) {
        return {
            kind: "ambiguous",
            reason: error instanceof FrozenEvidenceContradiction
                ? "settlement_evidence_contradiction"
                : "provider_evidence_capability_gap",
            ...(upperBlock === undefined ? {} : { upperBlock }),
        };
    }
}
/**
 * The first block at or after the evidence deadline closes the window. Any block with timestamp >= deadline is a
 * sound upper bound; block times are near-constant, so interpolation between the frozen lower block and the safe
 * head lands on the first one in about one header read (was a binary search of ~log2(range) reads plus a re-read).
 */
async function immutableUpper(operation, rpc, safe, deadline, rpcOrigin) {
    if (operation.immutableUpperBlock !== undefined) {
        const observed = await rpc.getX402Block(operation.immutableUpperBlock.number);
        assertBlock(observed, rpcOrigin);
        if (observed.hash !== operation.immutableUpperBlock.hash || observed.timestamp !== operation.immutableUpperBlock.timestamp) {
            throw new FrozenEvidenceContradiction();
        }
        return operation.immutableUpperBlock;
    }
    const frozenLower = operation.evidenceLowerBlock;
    const high = BigInt(safe.number);
    if (frozenLower === undefined || BigInt(frozenLower.number) >= high)
        throw protocol();
    const lower = await rpc.getX402Block(frozenLower.number);
    assertBlock(lower, rpcOrigin);
    if (lower.number !== frozenLower.number || lower.hash !== frozenLower.hash || lower.timestamp !== frozenLower.timestamp) {
        throw new FrozenEvidenceContradiction();
    }
    if (BigInt(lower.timestamp) >= deadline)
        throw protocol();
    let low = { number: BigInt(lower.number), timestamp: BigInt(lower.timestamp) };
    for (let reads = 0; reads < MAX_UPPER_READS && high - low.number > 1n; reads += 1) {
        const span = high - low.number, elapsed = BigInt(safe.timestamp) - low.timestamp;
        let guess = elapsed <= 0n ? high - 1n : low.number + ((deadline - low.timestamp) * span + elapsed - 1n) / elapsed;
        if (guess >= high)
            guess = high - 1n;
        if (guess <= low.number)
            guess = low.number + 1n;
        const block = await rpc.getX402Block(guess.toString());
        assertBlock(block, rpcOrigin);
        if (BigInt(block.timestamp) >= deadline)
            return block;
        low = { number: guess, timestamp: BigInt(block.timestamp) };
    }
    const upper = await rpc.getX402Block(safe.number);
    assertBlock(upper, rpcOrigin);
    if (upper.hash !== safe.hash || BigInt(upper.timestamp) < deadline)
        throw protocol();
    return upper;
}
async function outgoingTransfers(rpc, payer, start, end) {
    const output = [];
    let from = BigInt(start);
    const to = BigInt(end);
    while (from <= to) {
        const chunkEnd = from + 2047n < to ? from + 2047n : to;
        const response = await rpc.getX402TransferLogs({ from: payer, fromBlock: from.toString(), toBlock: chunkEnd.toString() });
        if (response.kind !== "complete")
            return null;
        output.push(...response.logs);
        if (output.length > 256)
            throw protocol();
        from = chunkEnd + 1n;
    }
    return output;
}
function matchesFrozenTransfer(log, operation) {
    if (log.address !== BASE_USDC.toLowerCase() || log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC ||
        log.data.length !== 66 || log.topics[1] !== addressTopic(operation.provider.payer) ||
        log.topics[2] !== addressTopic(operation.requirement.payee))
        return false;
    try {
        return BigInt(log.data) === BigInt(operation.requirement.amountAtomic);
    }
    catch {
        return false;
    }
}
function addressTopic(address) {
    return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
function assertHead(head, rpcOrigin) {
    if (head.queriedTag !== "safe" || head.rpcOrigin !== rpcOrigin)
        throw protocol();
    assertIdentity(head.number, head.hash, head.timestamp, head.observedAt);
}
function assertBlock(block, rpcOrigin) {
    if (block.queriedTag !== "number" || block.rpcOrigin !== rpcOrigin)
        throw protocol();
    assertIdentity(block.number, block.hash, block.timestamp, block.observedAt);
}
function assertIdentity(number, hash, timestamp, observedAt) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(number) || !/^0x[0-9a-f]{64}$/u.test(hash) || /^0x0{64}$/u.test(hash) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(timestamp) || !Number.isFinite(Date.parse(observedAt)) ||
        BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1_000)))
        throw protocol();
}
function protocol() { return new ApnError("APN_RPC_PROTOCOL", "Provider x402 Base evidence is invalid."); }
/** The chain contradicts a block hash this operation already froze; every other failure is retried. */
class FrozenEvidenceContradiction extends Error {
    constructor() { super("Provider x402 frozen block evidence changed."); }
}
//# sourceMappingURL=provider-x402-evidence.js.map