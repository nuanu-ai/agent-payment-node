import { canonicalJson, domainHash, hashObject } from "../canonical.js";
import { keccak256, toHex } from "viem";
export const SA_MATERIAL_DOMAINS = Object.freeze({
    encodedRoot: "apn.smart-account.gasless.encoded-root.v1",
    encodedChild: "apn.smart-account.gasless.encoded-child.v1",
    permissionContext: "apn.smart-account.gasless.permission-context.v1",
    payload: "apn.smart-account.gasless.payload.v1",
    requirements: "apn.smart-account.gasless.requirements.v1",
    material: "apn.smart-account.gasless.material.v1",
});
export function saSame(first, second) { return canonicalJson(first) === canonicalJson(second); }
/** Policy binds unchanged authority and exact atomic economics, independently of mutable observations. */
export function saPolicyHash(binding, request) {
    return hashObject({ purpose: "apn.smart-account.gasless.policy.v1", binding, request,
        exactNetAtomic: request.grossAtomic, actualFeeAtomic: "0", nativeDebitWei: "0", approval: "foreground_once" });
}
export function saRequirementsHash(requirements) {
    return domainHash(SA_MATERIAL_DOMAINS.requirements, canonicalJson(requirements));
}
/** Hash the canonical lowercase encoded one-root delegation context, as UTF-8 hex like retained APN material. */
export function saRootContextHash(rootContext) {
    return domainHash(SA_MATERIAL_DOMAINS.encodedRoot, rootContext);
}
export function saMaterialHash(operationId, fingerprint, hashes) {
    return domainHash(SA_MATERIAL_DOMAINS.material, canonicalJson({ operationId, fingerprint, ...hashes }));
}
export function saSalt(operationId, fingerprint) {
    return keccak256(toHex(`apn.smart-account.gasless\0${operationId}\0${fingerprint}`));
}
//# sourceMappingURL=integrity.js.map