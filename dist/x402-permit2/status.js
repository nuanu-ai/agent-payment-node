import { ApnError } from "../errors.js";
import { canonicalProfile } from "../wallet-policy.js";
import { Permit2ProductionRepository, publicPermit2Production } from "./production-repository.js";
/** Read-only status of one real Permit2 operation from the production journal: no initialization, locks, repair or network. */
export async function readPermit2ProductionStatus(root, requestedProfile, operationId) {
    const profile = canonicalProfile(requestedProfile);
    if (!/^[a-f0-9]{64}$/u.test(operationId))
        throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 operation ID.");
    const repository = new Permit2ProductionRepository(root);
    const record = await repository.findOperation(operationId);
    if (record === null)
        return { operationId, profile, state: "not_found" };
    if (record.profileHash !== repository.profileHash(profile)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 operation does not belong to the requested profile.", { reason: "x402_permit2_profile_mismatch" });
    }
    return { profile, ...publicPermit2Production(record) };
}
//# sourceMappingURL=status.js.map