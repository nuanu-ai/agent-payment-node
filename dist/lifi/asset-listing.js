import { canonicalJson } from "../canonical.js";
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
            if (token.listing === "legacy_pinned") {
                const reviewed = row.caip2 === "eip155:1" ? {
                    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", peers: [42161],
                    code: { upgradeability: "immutable", codeHash: "0x131ff5c755b710d543ea70fede2eb38e5d15b1456df0ae932ba12e2786f7e5df" }
                } : row.caip2 === "eip155:42161" ? {
                    address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", peers: [1],
                    code: { upgradeability: "beacon_proxy", codeHash: "0x9bb54fba14f3f66acb4acfdcb38af3737d65543274ad5e9bc794080b876ddf18",
                        beacon: "0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333", beaconCodeHash: "0x335bc199b68d92971edf04b2d907a18617249dc49f86d7699c4eec68cb882d6c",
                        implementation: "0x3f770Ac673856F105b586bb393d122721265aD46", implementationCodeHash: "0xc62ae99da1e885d46423d6b467371cda77d1711f0201343950722f6052ddbdfb" }
                } : null;
                if (reviewed === null || token.address !== reviewed.address || token.chainId !== row.chainId || token.kind !== "erc20" ||
                    token.symbol !== "WBTC" || token.coinKey !== "WBTC" || token.pairKey !== "wbtc" || token.decimals !== 8 || !token.acrossSupported ||
                    token.stargate !== null || token.approval !== "standard" || token.transferFee !== "none" ||
                    canonicalJson(token.peers) !== canonicalJson(reviewed.peers) || canonicalJson(token.code) !== canonicalJson(reviewed.code))
                    bridgeFailure("APN_INTERNAL", "bridge_registry_reviewed_wbtc_drift");
                continue;
            }
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