import { ApnError } from "../errors.js";
import { canonicalProfile } from "../wallet-policy.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { projectPermit2Production } from "./production-delivery.js";
/** Read-only status of one real Permit2 operation from the production journal and its saved seller answer: no initialization, locks, repair or network. */
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
    return { profile, ...await projectPermit2Production(root, record) };
}
//# sourceMappingURL=status.js.map