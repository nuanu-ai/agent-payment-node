/**
 * The operation index is a derived, rebuildable cache over the family journals (which stay the only source of truth).
 * It stores only what lookups and the one-operation-per-account guard need; deleting `operation-index/` is always safe.
 */
export const OPERATION_FAMILIES = [
    "direct_transfer", "x402_fetch", "rail_transfer", "bridge_route", "gasless_transfer", "metamask_gasless_transfer",
    "smart_account_gasless_transfer", "facilitator_gasless_transfer", "circle_route", "merchant_x402", "permit2_production",
    "relay_unsigned", "sei_gaszip", "mega_gaszip",
    // Families whose adapters join in phase 4b WP2.
    "swap", "uniswap_token", "stargate_native", "stargate_token", "gasless_usdt", "oneclick_source", "circle_source",
    "circle_approval", "metamask_native",
];
export const OPERATION_INDEX_ENTRY_SCHEMA = "apn.operation-index-entry.v1";
export const profileClaim = (profileHash) => ({ key: `profile:${profileHash}` });
export const unreadableProfileClaim = (profileHash) => ({ key: `unreadable:${profileHash}` });
export const unreadableFamilyClaim = (family) => ({ key: `unreadable-family:${family}` });
/** Held by an unreadable direct or x402 record that may have been a provider operation. */
export const UNREADABLE_PROVIDER_CLAIM = { key: "unreadable-provider" };
export function providerClaims(providerId, accountBindingHash, payer) {
    return [{ key: `provider:${providerId}:${accountBindingHash}` }, { key: `provider-payer:${providerId}:${payer.toLowerCase()}` }];
}
/** Deduplicated (an exclusive claim wins over a shared one on the same key) and sorted by key. */
export function normalizeClaims(claims) {
    const byKey = new Map();
    for (const claim of claims) {
        const prior = byKey.get(claim.key);
        byKey.set(claim.key, prior !== undefined && (prior.shared !== true || claim.shared !== true) ? { key: claim.key } : claim);
    }
    return [...byKey.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
/** The held claims that collide with the wanted ones under the exclusive/shared rule. */
export function collidingClaims(held, wanted) {
    const wantedByKey = new Map(wanted.map(claim => [claim.key, claim]));
    return held.filter(claim => {
        const other = wantedByKey.get(claim.key);
        return other !== undefined && !(claim.shared === true && other.shared === true);
    });
}
//# sourceMappingURL=types.js.map