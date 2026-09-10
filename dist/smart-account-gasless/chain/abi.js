import { getAddress, toEventSelector, toFunctionSelector } from "viem";
import { hashObject, isPlainRecord } from "../../canonical.js";
import { saFail } from "../reasons.js";
/** Internal sanitized signals used to preserve a truthful partial cursor. */
export class SaRpcBudgetError extends Error {
}
export class SaRpcRangeError extends Error {
}
export class SaRpcReorgError extends Error {
}
export class SaScanLimitError extends Error {
}
export const SA_ZERO_HEX_HASH = `0x${"0".repeat(64)}`;
export const SA_TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
export const SA_REDEEMED_TOPIC = toEventSelector("RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))");
export const SA_INCREASED_SPENT_TOPIC = toEventSelector("IncreasedSpentMap(address,address,bytes32,uint256,uint256)");
export const SA_REDEEM_SELECTOR = toFunctionSelector("redeemDelegations(bytes[],bytes32[],bytes[])");
export const SA_GET_AVAILABLE_SELECTOR = "0x6a9843f6";
export const SA_CURRENT_NONCE_SELECTOR = "0x2bd4ed21";
export const SA_SPENT_MAP_SELECTOR = toFunctionSelector("spentMap(address,bytes32)");
export const SA_DECIMALS_SELECTOR = toFunctionSelector("decimals()");
export const SA_DOMAIN_SEPARATOR_SELECTOR = toFunctionSelector("DOMAIN_SEPARATOR()");
export const SA_BALANCE_OF_SELECTOR = toFunctionSelector("balanceOf(address)");
export const SA_TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)");
export const SA_SINGLE_DEFAULT = `0x${"0".repeat(64)}`;
export const SA_CAVEAT_PARAMETER = {
    name: "caveats", type: "tuple[]", components: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" },
    ],
};
export const SA_DELEGATION_TUPLE_PARAMETER = {
    type: "tuple", components: [
        { name: "delegate", type: "address" },
        { name: "delegator", type: "address" },
        { name: "authority", type: "bytes32" },
        SA_CAVEAT_PARAMETER,
        { name: "salt", type: "uint256" },
        { name: "signature", type: "bytes" },
    ],
};
export const SA_DELEGATION_ARRAY_PARAMETER = { ...SA_DELEGATION_TUPLE_PARAMETER, type: "tuple[]" };
export function rpcRecord(value, reason = "sa_gasless_evidence") {
    if (!isPlainRecord(value))
        saFail(reason);
    return value;
}
/** JSON-RPC quantities are canonical lower-case uint256 values. */
export function rpcQuantity(value, reason = "sa_gasless_evidence") {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u.test(value))
        saFail(reason);
    return BigInt(value);
}
export function rpcHex(value, maximumBytes = 4 * 1024 * 1024, bytes, reason = "sa_gasless_evidence") {
    if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value) ||
        value.length > 2 + maximumBytes * 2 || (bytes !== undefined && value.length !== 2 + bytes * 2))
        saFail(reason);
    return value;
}
export function rpcAddress(value, reason = "sa_gasless_evidence") {
    try {
        return getAddress(rpcHex(value, 20, 20, reason)).toLowerCase();
    }
    catch {
        return saFail(reason);
    }
}
export function rpcWord(value, reason = "sa_gasless_evidence") {
    return BigInt(rpcHex(value, 32, 32, reason));
}
export function quantity(value) {
    if (value < 0n || value >= 1n << 256n)
        saFail("sa_gasless_evidence");
    return `0x${value.toString(16)}`;
}
export function addressWord(value) {
    return `0x${value.slice(2).padStart(64, "0")}`;
}
export function topicAddress(value) {
    if (!/^0x0{24}[0-9a-f]{40}$/u.test(value))
        saFail("sa_gasless_evidence");
    return rpcAddress(`0x${value.slice(-40)}`);
}
export function twoWords(value) {
    if (value.length !== 2 + 64 * 2)
        saFail("sa_gasless_evidence");
    return [BigInt(`0x${value.slice(2, 66)}`), BigInt(`0x${value.slice(66, 130)}`)];
}
export async function rpcBlock(call, tag, fullTransactions = false) {
    const raw = rpcRecord(await call("eth_getBlockByNumber", [tag, fullTransactions]));
    const number = rpcQuantity(raw.number), hash = rpcHex(raw.hash, 32, 32);
    if (hash === SA_ZERO_HEX_HASH || (tag.startsWith("0x") && number !== rpcQuantity(tag)))
        saFail("sa_gasless_evidence");
    const timestamp = rpcQuantity(raw.timestamp);
    if (timestamp > 253402300799n)
        saFail("sa_gasless_evidence");
    return { block: { numberAtomic: number.toString(), hash, timestampAtomic: timestamp.toString() }, raw,
        tag: quantity(number) };
}
export function sameBlock(left, right) {
    return left.numberAtomic === right.numberAtomic && left.hash === right.hash && left.timestampAtomic === right.timestampAtomic;
}
export async function recheckBlock(call, block, reason = "sa_gasless_evidence", signalReorg = false) {
    const current = await rpcBlock(call, quantity(BigInt(block.numberAtomic)));
    if (!sameBlock(current.block, block)) {
        if (signalReorg)
            throw new SaRpcReorgError();
        saFail(reason);
    }
}
export function parseReceiptLogs(value, transactionHash, block, transactionIndex) {
    if (!Array.isArray(value) || value.length > 512)
        saFail("sa_gasless_evidence");
    const indexes = new Set();
    let previous = -1n;
    return value.map((item) => {
        const log = rpcRecord(item), index = rpcQuantity(log.logIndex), indexAtomic = index.toString();
        if (indexes.has(indexAtomic) || index <= previous || rpcHex(log.transactionHash, 32, 32) !== transactionHash ||
            rpcHex(log.blockHash, 32, 32) !== block.hash || rpcQuantity(log.blockNumber).toString() !== block.numberAtomic ||
            rpcQuantity(log.transactionIndex) !== transactionIndex || log.removed !== false ||
            !Array.isArray(log.topics) || log.topics.length > 4)
            saFail("sa_gasless_evidence");
        indexes.add(indexAtomic);
        previous = index;
        return { address: rpcAddress(log.address), topics: log.topics.map(topic => rpcHex(topic, 32, 32)),
            data: rpcHex(log.data, 64 * 1024), logIndexAtomic: indexAtomic, transactionHash };
    });
}
export function receiptHash(chainId, transactionHash, block, status, logs) {
    return hashObject({ chainId, transactionHash, block, status: status.toString(), logs });
}
//# sourceMappingURL=abi.js.map