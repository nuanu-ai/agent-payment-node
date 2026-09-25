import { getAddress } from "viem";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MAX_EVM_UINT } from "./evm-asset.js";
export function evmRpcRecord(value, details) {
    if (!isPlainRecord(value))
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned a malformed object.", details);
    return value;
}
export function evmRpcQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned a noncanonical quantity.");
    }
    const result = BigInt(value);
    if (result > MAX_EVM_UINT)
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC quantity exceeds uint256.");
    return result;
}
export function evmRpcHex(value, bytes) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || (bytes !== undefined && value.length !== 2 + 2 * bytes)) {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned malformed bytes.");
    }
    return value.toLowerCase();
}
export function evmRpcWord(value) {
    return BigInt(evmRpcHex(value, 32));
}
export function evmRpcAddress(value) {
    try {
        return getAddress(evmRpcHex(value, 20));
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned an invalid address.");
    }
}
export async function evmRpcBlock(call, tag) {
    return evmRpcBlockResult(await call("eth_getBlockByNumber", [tag, false]), tag);
}
/** Decode a block already fetched with other independent reads in one RPC batch. */
export function evmRpcBlockResult(value, tag) {
    const blockTag = tag === "latest" || tag === "safe" || tag === "finalized" ? tag : "number";
    const raw = evmRpcRecord(value, {
        rpcMethod: "eth_getBlockByNumber", stage: "block_result", blockTag,
    });
    const number = evmRpcQuantity(raw.number);
    const hash = evmRpcHex(raw.hash, 32);
    if (hash === `0x${"0".repeat(64)}` || (tag.startsWith("0x") && number !== evmRpcQuantity(tag))) {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC block identity is inconsistent.");
    }
    return { tag: `0x${number.toString(16)}`, number: number.toString(), hash, raw };
}
export async function recheckEvmBlock(call, block) {
    if ((await evmRpcBlock(call, block.tag)).hash !== block.hash)
        throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
}
export async function evmTokenBalance(call, token, address, tag) {
    const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
    return evmRpcWord(await call("eth_call", [{ to: token, data }, tag]));
}
//# sourceMappingURL=evm-rpc-codec.js.map