import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { NATIVE_ASSET_ADDRESS } from "../evm-asset.js";
const row = (chainId, eid, asset, token, pool, kind) => Object.freeze({ chainId, eid, asset, token: getAddress(token), pool: getAddress(pool), kind,
    localDecimals: asset === "ETH" ? 18 : 6, sharedDecimals: 6 });
/**
 * Exact intersections of the active eleven-network allowlist and the official Stargate registry at the recorded commits.
 * No provider discovery, token alias, wrapped asset, or unlisted Stargate deployment may widen this table.
 */
export const STARGATE_V2_DEPLOYMENTS = Object.freeze([
    row(1, 30101, "ETH", NATIVE_ASSET_ADDRESS, "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931", "StargatePoolNative"),
    row(1, 30101, "USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xc026395860Db2d07ee33e05fE50ed7bD583189C7", "pool"),
    row(1, 30101, "USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", "0x933597a323Eb81cAe705C5bC29985172fd5A3973", "pool"),
    row(8453, 30184, "ETH", NATIVE_ASSET_ADDRESS, "0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7", "StargatePoolNative"),
    row(8453, 30184, "USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0x27a16dc786820B16E5c9028b75B99F6f604b5d26", "pool"),
    row(42161, 30110, "ETH", NATIVE_ASSET_ADDRESS, "0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F", "StargatePoolNative"),
    row(42161, 30110, "USDC", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3", "pool"),
    row(10, 30111, "ETH", NATIVE_ASSET_ADDRESS, "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3", "StargatePoolNative"),
    row(10, 30111, "USDC", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0", "pool"),
    row(137, 30109, "USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4", "pool"),
    row(43114, 30106, "USDC", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47", "pool"),
    row(43114, 30106, "USDT", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "0x12dC9256Acc9895B076f6638D628382881e62CeE", "pool"),
    row(130, 30320, "ETH", NATIVE_ASSET_ADDRESS, "0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7", "StargatePoolNative"),
]);
function fail(reason) {
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", `Direct Stargate V2 quote unavailable: ${reason}.`);
}
export function stargateV2Deployment(chainId, token) {
    if (typeof chainId !== "number" || !Number.isSafeInteger(chainId))
        return fail("unknown chain");
    let address;
    try {
        address = getAddress(token);
    }
    catch {
        return fail("unknown token");
    }
    return STARGATE_V2_DEPLOYMENTS.find((entry) => entry.chainId === chainId && entry.token === address) ?? fail("unknown chain/token/EID/contract");
}
export function stargateV2Route(source, destination) {
    const from = stargateV2Deployment(source.chainId, source.token === "native" ? NATIVE_ASSET_ADDRESS : source.token);
    const to = stargateV2Deployment(destination.chainId, destination.token === "native" ? NATIVE_ASSET_ADDRESS : destination.token);
    if (from.chainId === to.chainId)
        return fail("source and destination chain are identical");
    if (from.asset !== to.asset)
        return fail("source and destination asset identities differ");
    return Object.freeze({ from, to });
}
//# sourceMappingURL=registry.js.map