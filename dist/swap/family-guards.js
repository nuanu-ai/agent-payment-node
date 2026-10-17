import { validateAssetPolicyRegistry } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { requireSwapProtocol, validateSwapProtocolRegistry } from "./protocol-registry.js";
const LABEL = { uniswap: "Uniswap", sunswap: "SunSwap", orca: "Orca" };
/** The protocol registry the driver runs with must be the one the operation was prepared under and admit its mechanism. */
export function assertOperationProtocolRegistry(operation, registryValue, family) {
    const registry = validateSwapProtocolRegistry(registryValue);
    if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion) {
        blocked(`Injected ${LABEL[family]} protocol registry does not match the prepared operation.`, `${family}_protocol_registry_drift`);
    }
    requireSwapProtocol(registry, operation.mechanismDigest);
    return registry;
}
/** Owner admission, policy half: the profile's active sealed policy must still be the one the operation was prepared under. */
export async function assertActiveSwapPolicyUnchanged(policy, operation) {
    const active = await policy(operation.quote.profile);
    if (active === null)
        blocked("No active owner swap admission is installed for this profile.", "swap_owner_admission_required");
    const registry = validateAssetPolicyRegistry(active);
    if (registry.policyDigest !== operation.policyDigest || registry.registryVersion !== operation.policyVersion) {
        blocked("The active owner policy changed after preparation.", "swap_policy_drift");
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=family-guards.js.map