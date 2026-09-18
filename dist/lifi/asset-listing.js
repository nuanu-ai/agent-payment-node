import { loadAllowlistInventory } from "../allowlist-inventory.js";
import { bridgeFailure } from "./validation.js";
/**
 * Binds the bridge registry to the frozen allowlist (`data/allowlist/2026-09-17/dataset.json`). Every native coin and
 * every `frozen_list` token row must be the list's exact identity: chain, kind, contract, symbol and decimals. A
 * `legacy_pinned` row (WBTC) predates the list and keeps its own pins. A drift is an installation fault, not a refusal.
 */
let verifiedRegistry = null;
export function assertBridgeRegistryListed(registry) {
    if (verifiedRegistry === registry)
        return;
    const assets = loadAllowlistInventory().assets;
    for (const row of Object.values(registry)) {
        const native = assets.filter((asset) => asset.chain === row.caip2 && asset.kind === "native");
        if (native.length !== 1 || native[0].symbol !== row.nativeCoin.symbol || native[0].decimals !== row.nativeCoin.decimals ||
            row.nativeCoin.listing !== "frozen_list")
            bridgeFailure("APN_INTERNAL", "bridge_registry_native_list_drift");
        for (const token of row.tokens) {
            if (token.listing === "legacy_pinned")
                continue;
            const listed = assets.filter((asset) => asset.chain === row.caip2 && asset.kind === "token" && asset.identifier === token.address);
            if (token.listing !== "frozen_list" || listed.length !== 1 || listed[0].symbol !== token.symbol ||
                listed[0].decimals !== token.decimals)
                bridgeFailure("APN_INTERNAL", "bridge_registry_token_list_drift");
        }
    }
    verifiedRegistry = registry;
}
/** True only when the frozen list names this exact EVM token deployment on this chain. */
export function bridgeTokenListed(caip2, token) {
    return loadAllowlistInventory().assets.some((asset) => asset.chain === caip2 && asset.kind === "token" && asset.identifier === token);
}
//# sourceMappingURL=asset-listing.js.map