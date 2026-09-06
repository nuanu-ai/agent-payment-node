import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { formatAtomic, parseAtomic, parseDecimal } from "./money.js";
export const EVM_NETWORKS = [{ chainId: 8453, name: "Base", caip2: "eip155:8453" }];
export const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MAX_EVM_UINT = (1n << 256n) - 1n;
export const MAX_DIRECT_TRANSACTION_BYTES = 512;
export function evmChain(value) {
    const network = EVM_NETWORKS.find((entry) => value === entry.chainId || value === entry.caip2);
    if (network === undefined)
        throw new ApnError("APN_INVALID_INPUT", "Select an enabled EVM mainnet by its exact CAIP-2 identity.");
    return network.chainId;
}
export function evmToken(value) {
    if (value === "native")
        return value;
    if (typeof value !== "string")
        throw new ApnError("APN_INVALID_INPUT", "Asset must be native or an exact ERC-20 contract address.");
    let address;
    try {
        address = getAddress(value);
    }
    catch {
        throw new ApnError("APN_INVALID_INPUT", "ERC-20 contract address is invalid.");
    }
    if (address === NATIVE_ASSET_ADDRESS)
        throw new ApnError("APN_INVALID_INPUT", "The zero address is not an ERC-20 contract.");
    return address;
}
export function evmDecimals(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 255) {
        throw new ApnError("APN_INVALID_INPUT", "Asset decimals must be an integer from 0 through 255.");
    }
    return value;
}
export function evmUint(value, positive = false) {
    if (typeof value !== "string" || value.length > 78)
        throw new ApnError("APN_INVALID_INPUT", "EVM quantity must be a canonical uint256 string.");
    const atomic = parseAtomic(value, { positive });
    if (atomic > MAX_EVM_UINT)
        throw new ApnError("APN_INVALID_INPUT", "EVM quantity exceeds uint256.");
    return atomic;
}
export function evmAmount(value, decimals) {
    evmDecimals(decimals);
    if (typeof value !== "string" || value.length > 335)
        throw new ApnError("APN_INVALID_INPUT", "EVM amount exceeds the bounded decimal representation.");
    const result = parseDecimal(value, decimals, { positive: true });
    evmUint(result.atomic, true);
    return result;
}
export function resolveEvmAsset(selection, observedDecimals) {
    const chainId = evmChain(selection.chainId);
    const token = evmToken(selection.token);
    if (selection.decimals !== undefined)
        evmDecimals(selection.decimals);
    if (token === "native") {
        if (selection.decimals !== undefined && selection.decimals !== 18)
            throw new ApnError("APN_INVALID_INPUT", "Native ETH has exactly 18 decimals.");
        return { schemaVersion: "apn.evm-asset.v1", chainId, kind: "native", address: NATIVE_ASSET_ADDRESS, decimals: 18, decimalsSource: "native" };
    }
    if (observedDecimals !== undefined)
        evmDecimals(observedDecimals);
    if (observedDecimals !== undefined && selection.decimals !== undefined && observedDecimals !== selection.decimals) {
        throw new ApnError("APN_ASSET_MISMATCH", "Supplied decimals disagree with the selected token's observed decimals.");
    }
    const decimals = observedDecimals ?? selection.decimals;
    if (decimals === undefined)
        throw new ApnError("APN_ASSET_METADATA_REQUIRED", "Token decimals are unavailable; explicitly supply the independently verified decimals.");
    return { schemaVersion: "apn.evm-asset.v1", chainId, kind: "erc20", address: token, decimals, decimalsSource: observedDecimals === undefined ? "caller" : "onchain" };
}
export function validateEvmAsset(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "chainId", "kind", "address", "decimals", "decimalsSource"])) {
        throw new ApnError("APN_STATE_CORRUPT", "Frozen EVM asset schema is invalid.");
    }
    const asset = value;
    try {
        evmChain(asset.chainId);
        evmDecimals(asset.decimals);
        if (asset.schemaVersion !== "apn.evm-asset.v1")
            throw new Error("version");
        if (asset.kind === "native") {
            if (asset.address !== NATIVE_ASSET_ADDRESS || asset.decimals !== 18 || asset.decimalsSource !== "native")
                throw new Error("native");
        }
        else if (asset.kind !== "erc20" || evmToken(asset.address) !== asset.address || !["onchain", "caller"].includes(asset.decimalsSource)) {
            throw new Error("token");
        }
    }
    catch {
        throw new ApnError("APN_STATE_CORRUPT", "Frozen EVM asset identity is invalid.");
    }
    return asset;
}
export function publicEvmAsset(asset) {
    return {
        chain: `eip155:${asset.chainId}`,
        kind: asset.kind,
        contract: asset.kind === "native" ? null : asset.address,
        decimals: asset.decimals,
        decimals_source: asset.decimalsSource,
    };
}
export function validateEvmAmount(asset, atomic, decimal) {
    evmUint(atomic, true);
    if (formatAtomic(atomic, asset.decimals) !== decimal)
        throw new ApnError("APN_STATE_CORRUPT", "Frozen asset amount and decimals disagree.");
}
//# sourceMappingURL=evm-asset.js.map