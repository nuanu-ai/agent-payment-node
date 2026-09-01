import { hashObject, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
export class BaseExactTransactionEvidence {
    rpc;
    constructor(rpc) {
        this.rpc = rpc;
    }
    async observe(intent) {
        const rpc = exactReadPort(this.rpc);
        const chain = await rpc.assertBaseChain();
        if (chain.chainId !== 8453 || sha256(chain.rpcOrigin) !== intent.rpcOriginHash) {
            throw new ApnError("APN_CHAIN_MISMATCH", "Exact transaction recovery RPC does not match the frozen Base binding.");
        }
        const receipt = await rpc.getX402Receipt(intent.transactionHash);
        if (receipt === null) {
            throw new ApnError("APN_X402_RECOVERY_AMBIGUOUS", "The named transaction receipt is not yet available.");
        }
        if (receipt.transactionHash !== intent.transactionHash || receipt.status !== "success")
            invalid();
        const safeHead = await rpc.getX402Head("safe");
        const receiptBlock = await rpc.getX402Block(receipt.blockNumber);
        for (const origin of [receipt.rpcOrigin, safeHead.rpcOrigin, receiptBlock.rpcOrigin]) {
            if (sha256(origin) !== intent.rpcOriginHash) {
                throw new ApnError("APN_CHAIN_MISMATCH", "Exact transaction evidence changed RPC origin.");
            }
        }
        if (receipt.blockHash !== receiptBlock.hash || receipt.blockNumber !== receiptBlock.number ||
            BigInt(receiptBlock.number) > BigInt(safeHead.number) ||
            (receiptBlock.number === safeHead.number && receiptBlock.hash !== safeHead.hash)) {
            if (BigInt(receiptBlock.number) > BigInt(safeHead.number)) {
                throw new ApnError("APN_X402_RECOVERY_AMBIGUOUS", "The named transaction is not at or below the safe Base head.");
            }
            invalid();
        }
        const transfer = exactTransfer(receipt.logs, intent);
        if (transfer.blockNumber !== receipt.blockNumber || transfer.blockHash !== receipt.blockHash ||
            transfer.transactionHash !== receipt.transactionHash)
            invalid();
        const observedAt = latestObservation([
            receipt.observedAt, receiptBlock.observedAt, safeHead.observedAt,
        ]);
        const base = {
            schemaVersion: "apn.provider-x402.transaction-settlement.v1",
            chainId: "8453",
            network: CHAIN_CAIP2,
            token: BASE_USDC.toLowerCase(),
            transactionHash: intent.transactionHash,
            receiptStatus: "success",
            receiptBlock,
            safeHead,
            payer: intent.payer,
            payee: intent.payee,
            amountAtomic: intent.amountAtomic,
            transfer: {
                logIndex: transfer.logIndex,
                blockNumber: transfer.blockNumber,
                blockHash: transfer.blockHash,
                transactionHash: transfer.transactionHash,
            },
            qualifyingTransferCount: "1",
            rpcOriginHash: intent.rpcOriginHash,
            observedAt,
        };
        return { ...base, evidenceHash: hashObject(base) };
    }
}
function exactReadPort(rpc) {
    const candidate = rpc;
    if (typeof candidate.getX402Receipt !== "function" || typeof candidate.getX402Head !== "function" ||
        typeof candidate.getX402Block !== "function")
        throw new ApnError("APN_OPERATION_BLOCKED", "Exact transaction recovery requires the read-only x402 RPC surface.");
    return candidate;
}
function exactTransfer(logs, intent) {
    const fromTopic = addressTopic(intent.payer);
    const outgoing = logs.filter((log) => log.address === BASE_USDC.toLowerCase() && log.topics[0] === TRANSFER_TOPIC && log.topics[1] === fromTopic);
    if (outgoing.length !== 1)
        invalid();
    const transfer = outgoing[0];
    if (transfer.topics.length !== 3 || transfer.topics[2] !== addressTopic(intent.payee) ||
        !/^0x[0-9a-f]{64}$/u.test(transfer.data) || BigInt(transfer.data) !== BigInt(intent.amountAtomic) ||
        transfer.transactionHash !== intent.transactionHash)
        invalid();
    return transfer;
}
function latestObservation(values) {
    if (values.some((value) => !canonicalUtc(value)))
        invalid();
    return new Date(Math.max(...values.map((value) => Date.parse(value)))).toISOString();
}
function addressTopic(address) {
    return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
function canonicalUtc(value) {
    return Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function invalid() {
    throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Exact transaction settlement evidence does not match the frozen operation.");
}
//# sourceMappingURL=provider-x402-transaction-evidence.js.map