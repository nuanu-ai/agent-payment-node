import { effectSlot } from "./local-wallet-native-fields.js";
/**
 * Bounds the encrypted wallet envelope. It keeps signed material only while something can still use it:
 * - a local x402 authorization until its validBefore: native custody refuses to return or re-sign it afterwards
 *   (ensureX402Live), and no chain can settle it any more;
 * - a generic direct-transfer effect until its operation is terminal: a terminal operation is never signed,
 *   resumed into a send or abandoned again, and its public journal keeps the transaction hashes.
 * Every other slot (Relay, Uniswap token custody, or anything not proven to belong to a terminal direct
 * operation) is kept unchanged. An unreadable operation record keeps its slot: retention never wedges signing.
 */
export async function releaseSettledWalletEffects(state, profile, secret, nowMs) {
    const nowSeconds = BigInt(Math.floor(nowMs / 1000));
    for (const [slot, effect] of Object.entries(secret.x402Effects)) {
        if (nowSeconds >= BigInt(effect.authorization.validBefore))
            delete secret.x402Effects[slot];
    }
    const profileHash = state.profileHash(profile);
    for (const [slot, effect] of Object.entries(secret.directEffects)) {
        if (effect.operationId === undefined)
            continue;
        const operation = await readable(() => state.loadOperation(profileHash, effect.operationId));
        if (operation !== null && ownsSlot(operation, profile, slot, effect) && operation.terminal)
            delete secret.directEffects[slot];
    }
    const untagged = Object.entries(secret.directEffects).filter(([, effect]) => effect.operationId === undefined);
    if (untagged.length === 0)
        return;
    // Envelopes written before 0.5.42 carry no owner tag. Match them to this profile's direct operations once:
    // terminal owners release their slot, live owners get tagged so later saves need one record read per slot.
    const operations = await readable(() => state.listOperations(profileHash)) ?? [];
    const bySlot = new Map(operations.map(operation => [effectSlot("apn-effect-v1", operation.profile, operation.operationId, operation.fingerprint), operation]));
    for (const [slot, effect] of untagged) {
        const operation = bySlot.get(slot);
        if (operation === undefined || !ownsSlot(operation, profile, slot, effect))
            continue;
        if (operation.terminal)
            delete secret.directEffects[slot];
        else
            secret.directEffects[slot] = { ...effect, operationId: operation.operationId };
    }
}
function ownsSlot(operation, profile, slot, effect) {
    return operation.profile === profile && operation.providerDirect === undefined &&
        effectSlot("apn-effect-v1", profile, operation.operationId, operation.fingerprint) === slot &&
        (operation.transactionHash === undefined || operation.transactionHash === effect.transactionHash);
}
async function readable(read) {
    try {
        return await read();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=wallet-effect-retention.js.map