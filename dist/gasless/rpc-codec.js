import { getAddress } from "viem";
import { hashObject, isPlainRecord } from "../canonical.js";
import { gaslessFailure } from "./validation.js";
export function rpcRecord(value) {
    if (!isPlainRecord(value))
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_record");
    return value;
}
export function rpcJson(value, maximumBytes) {
    if (Buffer.byteLength(value, "utf8") > maximumBytes)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response_size");
    try {
        return JSON.parse(value);
    }
    catch {
        return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_JSON");
    }
}
export function rpcQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_quantity");
    }
    return BigInt(value);
}
export function rpcHex(value, maximumBytes = 256 * 1024, bytes) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) ||
        value.length > 2 + maximumBytes * 2 || (bytes !== undefined && value.length !== 2 + bytes * 2)) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_hex");
    }
    return value.toLowerCase();
}
export function rpcWord(value) { return BigInt(rpcHex(value, 32, 32)); }
export function rpcBool(value) {
    const word = rpcWord(value);
    if (word !== 0n && word !== 1n)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_boolean");
    return word === 1n;
}
export function rpcAddress(value) {
    try {
        return getAddress(rpcHex(value, 20, 20));
    }
    catch {
        return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_address");
    }
}
export function quantity(value) {
    if (value < 0n || value >= 1n << 256n)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_quantity_bound");
    return `0x${value.toString(16)}`;
}
export function addressWord(value) { return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`; }
export async function rpcBlock(call, tag) {
    const raw = rpcRecord(await call("eth_getBlockByNumber", [tag, false]));
    const number = rpcQuantity(raw.number), hash = rpcHex(raw.hash, 32, 32);
    if (hash === `0x${"0".repeat(64)}` || (tag.startsWith("0x") && number !== rpcQuantity(tag))) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_identity");
    }
    const block = { numberAtomic: number.toString(), hash, timestampAtomic: rpcQuantity(raw.timestamp).toString() };
    return { block, tag: quantity(number), raw };
}
/** Polygon exposes milestone finality through finalized; unavailable finality never falls back to latest. */
export async function rpcFinalityBlock(call, chainId) {
    return await rpcBlock(call, chainId === 137 ? "finalized" : "safe");
}
export async function recheckBlock(call, block) {
    const again = await rpcBlock(call, quantity(BigInt(block.numberAtomic)));
    if (!sameBlock(again.block, block))
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
}
export function sameBlock(left, right) {
    return left.numberAtomic === right.numberAtomic && left.hash === right.hash && left.timestampAtomic === right.timestampAtomic;
}
export function parseReceiptLogs(value, transactionHash, block, transactionIndex) {
    if (!Array.isArray(value) || value.length > 512)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_log_count");
    const indexes = new Set();
    return value.map((item) => {
        const log = rpcRecord(item), logIndex = rpcQuantity(log.logIndex).toString();
        if (indexes.has(logIndex) || rpcHex(log.transactionHash, 32, 32) !== transactionHash ||
            rpcHex(log.blockHash, 32, 32) !== block.hash || rpcQuantity(log.blockNumber).toString() !== block.numberAtomic ||
            rpcQuantity(log.transactionIndex) !== transactionIndex || log.removed !== false ||
            !Array.isArray(log.topics) || log.topics.length > 4) {
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_log_membership");
        }
        indexes.add(logIndex);
        return { address: rpcAddress(log.address), topics: log.topics.map((topic) => rpcHex(topic, 32, 32)),
            data: rpcHex(log.data, 64 * 1024), logIndexAtomic: logIndex };
    });
}
export function receiptHash(chainId, transactionHash, block, status, logs) {
    return hashObject({ chainId, transactionHash, block, status: status.toString(), logs });
}
//# sourceMappingURL=rpc-codec.js.map