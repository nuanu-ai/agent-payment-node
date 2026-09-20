import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
export const STARGATE_V2_FINALITY_POLICY_VERSION = "apn.stargate-v2-finality.v1";
export const STARGATE_V2_LEGACY_FINALITY_POLICY_VERSION = "apn.stargate-v2-finality.legacy-safe-v1";
const TAG_BY_CHAIN = Object.freeze({
    1: "safe",
    10: "safe",
    130: "safe",
    137: "finalized",
    8453: "safe",
    42161: "safe",
    43114: "safe",
});
export function stargateV2ChainFinalityPolicy(chainId) {
    const blockTag = TAG_BY_CHAIN[chainId];
    if (blockTag === undefined)
        throw new ApnError("APN_RPC_CONFIG", "Stargate finality policy does not admit this chain.", { chainId: String(chainId) });
    return Object.freeze({ chainId: chainId, blockTag });
}
export function stargateV2RouteFinalityPolicy(sourceChainId, destinationChainId) {
    return Object.freeze({ version: STARGATE_V2_FINALITY_POLICY_VERSION,
        source: stargateV2ChainFinalityPolicy(sourceChainId), destination: stargateV2ChainFinalityPolicy(destinationChainId) });
}
export function stargateV2LegacyRouteFinalityPolicy(sourceChainId, destinationChainId) {
    const source = stargateV2ChainFinalityPolicy(sourceChainId), destination = stargateV2ChainFinalityPolicy(destinationChainId);
    return Object.freeze({ version: STARGATE_V2_LEGACY_FINALITY_POLICY_VERSION,
        source: { chainId: source.chainId, blockTag: "safe" }, destination: { chainId: destination.chainId, blockTag: "safe" } });
}
export function assertStargateV2RouteFinalityPolicy(value, sourceChainId, destinationChainId) {
    if (!samePolicy(value, stargateV2RouteFinalityPolicy(sourceChainId, destinationChainId))) {
        throw new ApnError("APN_STATE_CORRUPT", "The frozen Stargate finality policy does not match the pinned chain policy.");
    }
}
export function assertStargateV2LegacyRouteFinalityPolicy(value, sourceChainId, destinationChainId) {
    if (!samePolicy(value, stargateV2LegacyRouteFinalityPolicy(sourceChainId, destinationChainId))) {
        throw new ApnError("APN_STATE_CORRUPT", "The migrated Stargate finality policy does not match the historical safe-tag policy.");
    }
}
function samePolicy(actual, expected) {
    try {
        return canonicalJson(actual) === canonicalJson(expected);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=finality-policy.js.map