import { canonicalJson, domainHash, hashObject, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { appendProviderX402Transition, sealProviderX402Operation, } from "./provider-x402-model.js";
import { freezeProviderPolicy } from "./provider-x402-policy.js";
const BODY_DIGEST = domainHash("apn.x402.absent-body.v1", canonicalJson({ state: "absent" }));
export function stagedProviderX402Operation(input) {
    const canonicalUrl = input.endpoint.toString();
    const requestMetadata = { method: "GET", bodyState: "absent", headers: "none" };
    const requestDigest = domainHash("apn.provider-x402.request.v1", canonicalJson({
        canonicalUrl, ...requestMetadata, bodyDigest: BODY_DIGEST,
    }));
    const requirement = {
        x402Version: "2",
        scheme: "exact",
        network: CHAIN_CAIP2,
        token: BASE_USDC.toLowerCase(),
        decimals: 6,
        payee: input.selected.payee,
        amountAtomic: input.selected.amountAtomic,
        declaredCanonicalJson: canonicalJson(input.selected.requirements),
        digest: input.selected.digest,
    };
    const provider = {
        providerId: input.bound.provider_id,
        profileRevision: input.bound.revision,
        capabilityHash: input.bound.capability_hash,
        accountBindingHash: input.bound.account_binding_hash,
        payer: input.bound.public_address.toLowerCase(),
        executionOwner: "provider",
        retryOwner: "apn_outer_no_replay_journal",
    };
    const policy = freezeProviderPolicy(input.policy, input.callerCapAtomic, input.effectiveCapAtomic);
    const rpcBindingHash = sha256(`provider-x402-rpc\0${input.rpcUrl}`);
    const rpcOriginHash = sha256(new URL(input.rpcUrl).origin);
    const fingerprint = hashObject({
        operationId: input.operationId,
        idempotencyHash: input.idempotencyHash,
        profile: input.profile,
        profileHash: input.profileHash,
        provider,
        request: { canonicalUrl, method: "GET", bodyState: "absent", bodyDigest: BODY_DIGEST, requestDigest },
        requirement,
        policy,
        rpcBindingHash,
        rpcOriginHash,
    });
    const initial = {
        at: input.createdAt,
        state: "preparing",
        reason: "x402_preparation_observation_pending",
        proofClass: "x402_frozen_offer",
    };
    return sealProviderX402Operation({
        schemaVersion: "apn.provider-x402.state.v1",
        kind: "x402_fetch",
        executionMode: "provider_atomic_paid_fetch",
        operationId: input.operationId,
        idempotencyHash: input.idempotencyHash,
        profile: input.profile,
        profileHash: input.profileHash,
        requestHash: input.requestHash,
        fingerprint,
        provider,
        request: {
            canonicalUrl,
            origin: input.endpoint.origin,
            path: input.endpoint.pathname,
            urlHash: sha256(canonicalUrl),
            method: "GET",
            bodyState: "absent",
            bodyDigest: BODY_DIGEST,
            metadataDigest: hashObject(requestMetadata),
            requestDigest,
        },
        requirement,
        policy,
        rpcBindingHash,
        rpcOriginHash,
        state: initial.state,
        finalityClass: "pre_effect",
        terminal: false,
        reason: initial.reason,
        proofClass: initial.proofClass,
        nextActions: ["operation.status", "operation.resume"],
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        transitions: appendProviderX402Transition([], initial),
    });
}
//# sourceMappingURL=provider-x402-stage.js.map