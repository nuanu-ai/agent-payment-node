import { mmFail } from "./reasons.js";
import { mmCanonicalAddress } from "./validation.js";
/**
 * The deployment exactly as this saved record froze it at prepare. Saved records are validated against their own
 * values, never against today's registry: a registry change refuses new prepares, never the operations already saved.
 */
export function mmRecordedDeployment(intent) {
    const caveats = intent.unsignedDelegation?.caveats;
    if (!Array.isArray(caveats) || caveats.length !== 2)
        mmFail("mm_gasless_state_corrupt");
    const enforcer = (index) => mmCanonicalAddress(caveats[index]?.enforcer);
    return { token: mmCanonicalAddress(intent.token), protocol: {
            manager: { address: mmCanonicalAddress(intent.relayTo) }, limitedCalls: { address: enforcer(0) },
            ...(intent.quote.feeMode === "sponsored" ? {} : { exactBatch: { address: enforcer(1) } }),
        } };
}
//# sourceMappingURL=recorded.js.map