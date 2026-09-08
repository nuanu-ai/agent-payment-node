import { decodeAbiParameters } from "viem";
import { ApnError } from "./errors.js";
const MAX_X402_TOPICS = 4;
const MAX_X402_LOG_DATA_BYTES = 4096;
export function record(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    return value;
}
export function rpcQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC quantity is not canonical hexadecimal.");
    return BigInt(value);
}
export function rpcHex(value, byteLength) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data is invalid.");
    if (byteLength !== undefined && value.length !== 2 + byteLength * 2)
        throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data has the wrong length.");
    return value.toLowerCase();
}
export function rpcAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC address is invalid.");
    return value;
}
export function nonzeroBytes32(value, label) {
    const parsed = rpcHex(value, 32);
    if (/^0x0{64}$/u.test(parsed))
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is zero.`);
    return parsed;
}
export function x402RpcLog(value) {
    const log = record(value, "x402 log");
    if (!Array.isArray(log.topics) || log.topics.length > MAX_X402_TOPICS) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics exceed the fixed bound.");
    }
    const data = rpcHex(log.data);
    if ((data.length - 2) / 2 > MAX_X402_LOG_DATA_BYTES) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC log data exceeds the fixed bound.");
    }
    return {
        address: rpcAddress(log.address).toLowerCase(),
        topics: log.topics.map((topic) => rpcHex(topic, 32)),
        data,
        blockNumber: rpcQuantity(log.blockNumber).toString(),
        blockHash: nonzeroBytes32(log.blockHash, "log block hash"),
        transactionHash: nonzeroBytes32(log.transactionHash, "log transaction hash"),
        logIndex: rpcQuantity(log.logIndex).toString(),
    };
}
export function rpcString(value, label) {
    const encoded = rpcHex(value);
    try {
        const [decoded] = decodeAbiParameters([{ type: "string" }], encoded);
        if (decoded.length === 0 || Buffer.byteLength(decoded, "utf8") > 128)
            throw new Error("bounded string");
        return decoded;
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    }
}
export function rpcUint256Data(value, label) {
    try {
        return BigInt(rpcHex(value, 32)).toString();
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    }
}
//# sourceMappingURL=base-rpc-codec.js.map