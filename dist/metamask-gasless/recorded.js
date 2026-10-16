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
/**
 * The deployment an observation proves against: the token, manager and enforcer addresses this record froze, with the
 * code pins its own prepare snapshot read. A pin change in a later release refuses new prepares only; an operation sent
 * before it is still proven against what it was sent with. Chain facts (finality tag) and the 7702 delegate address,
 * which a record without a designation at prepare does not hold, come from the registry row of the chain.
 */
export function mmObservedDeployment(intent, chain) {
    const recorded = mmRecordedDeployment(intent), pins = intent.initialSnapshot.safeState;
    const code = pins.protocolCodeHashes;
    const pin = (name, address) => ({ address, codeHash: code[name] ?? mmFail("mm_gasless_state_corrupt") });
    return { deploymentEvidenceHash: intent.deploymentEvidenceHash, row: { ...chain.row, token: recorded.token,
            tokenProxyCodeHash: pins.tokenProxyCodeHash, tokenImplementationAddress: pins.tokenImplementationAddress,
            tokenImplementationCodeHash: pins.tokenImplementationCodeHash,
            protocol: { manager: pin("manager", recorded.protocol.manager.address),
                delegate: pin("delegate", chain.row.protocol.delegate.address),
                limitedCalls: pin("limitedCalls", recorded.protocol.limitedCalls.address),
                exactBatch: recorded.protocol.exactBatch === undefined ? chain.row.protocol.exactBatch
                    : pin("exactBatch", recorded.protocol.exactBatch.address) } } };
}
//# sourceMappingURL=recorded.js.map