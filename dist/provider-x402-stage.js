import { canonicalJson, hashObject, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { appendProviderX402Transition, sealProviderX402Operation, } from "./provider-x402-model.js";
import { freezeProviderPolicy } from "./provider-x402-policy.js";
import { providerHttpRequest } from "./provider-x402-http-request.js";
export function stagedProviderX402Operation(input) {
    const canonicalUrl = input.endpoint.toString();
    const request = providerHttpRequest(input.endpoint, input.httpRequest);
    const { method, bodyState, bodyDigest, requestDigest } = request;
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
        request: { canonicalUrl, method, bodyState, bodyDigest, requestDigest },
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
        schemaVersion: input.httpRequest === undefined ? "apn.provider-x402.state.v1" : "apn.provider-x402.state.v2",
        kind: "x402_fetch",
        executionMode: "provider_atomic_paid_fetch",
        operationId: input.operationId,
        idempotencyHash: input.idempotencyHash,
        profile: input.profile,
        profileHash: input.profileHash,
        requestHash: input.requestHash,
        fingerprint,
        provider,
        request,
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