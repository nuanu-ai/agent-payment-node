import { domainHash, hashObject } from "./canonical.js";
import { ApnError } from "./errors.js";
import { formatAtomic } from "./money.js";
import { verifyAndConstructX402PaymentMaterial, } from "./x402-native.js";
export class ProviderX402AuthorizationService {
    context;
    store;
    constructor(context, store) {
        this.context = context;
        this.store = store;
    }
    async authorize(operation, kind) {
        const binding = providerAuthorizationBinding(operation);
        const intent = signingIntent(operation);
        const requestHash = providerAuthorizationRequestHash(binding, intent);
        const signer = await this.requiredSigner(operation);
        const existing = await this.store.load(binding);
        if (existing !== null) {
            if (existing.requestHash !== requestHash)
                corrupt("Provider authorization request binding changed.");
            return await this.continueExisting(operation, binding, existing, signer);
        }
        if (kind === "get")
            corrupt("Provider authorization recovery marker is missing.");
        await this.store.save(binding, {
            schemaVersion: "apn.provider-authorization.v1",
            requestHash,
            phase: "invocation_started",
            updatedAt: this.context.clock.now().toISOString(),
        });
        let outcome;
        try {
            outcome = await signer.request(intent);
        }
        catch {
            return { disposition: "ambiguous" };
        }
        return await this.acceptOutcome(operation, binding, requestHash, outcome);
    }
    async continueExisting(operation, binding, existing, signer) {
        if (existing.phase === "signed")
            return {
                disposition: "signed",
                material: await this.verified(operation, existing.signature, existing.signatureHash),
            };
        if (existing.phase === "rejected")
            return { disposition: "rejected" };
        if (existing.phase === "invocation_started")
            return { disposition: "ambiguous" };
        let outcome;
        try {
            outcome = await signer.observe({
                recoveryToken: existing.recoveryToken,
                sender: operation.wallet,
            });
        }
        catch {
            return { disposition: "pending" };
        }
        if (outcome.disposition === "ambiguous")
            return { disposition: "pending" };
        return await this.acceptOutcome(operation, binding, existing.requestHash, outcome);
    }
    async acceptOutcome(operation, binding, requestHash, outcome) {
        const updatedAt = this.context.clock.now().toISOString();
        if (outcome.disposition === "pending") {
            await this.store.save(binding, {
                schemaVersion: "apn.provider-authorization.v1",
                requestHash,
                phase: "pending",
                recoveryToken: outcome.recoveryToken,
                providerState: outcome.providerState,
                updatedAt,
            });
            return { disposition: "pending" };
        }
        if (outcome.disposition === "rejected") {
            await this.store.save(binding, {
                schemaVersion: "apn.provider-authorization.v1",
                requestHash,
                phase: "rejected",
                rejection: outcome.reason,
                updatedAt,
            });
            return { disposition: "rejected" };
        }
        if (outcome.disposition === "ambiguous")
            return { disposition: "ambiguous" };
        const signatureHash = domainHash("apn.x402.signature.v1", Buffer.from(outcome.signature.slice(2), "hex"));
        const material = await this.verified(operation, outcome.signature, signatureHash);
        await this.store.save(binding, {
            schemaVersion: "apn.provider-authorization.v1",
            requestHash,
            phase: "signed",
            signature: outcome.signature,
            signatureHash,
            updatedAt,
        });
        return { disposition: "signed", material };
    }
    async verified(operation, signature, signatureHash) {
        const native = {
            authorization: {
                from: operation.authorization.from,
                to: operation.authorization.to,
                value: operation.authorization.value,
                validAfter: operation.authorization.validAfter,
                validBefore: operation.authorization.validBefore,
                nonce: operation.authorization.nonce,
            },
            signature,
            signatureHash,
        };
        return await verifyAndConstructX402PaymentMaterial(native, operation);
    }
    async requiredSigner(operation) {
        const binding = operation.providerSigner;
        if (binding === undefined)
            corrupt("Provider x402 signer binding is missing.");
        const profile = await this.context.requireProfileRepository().load(operation.profileHash);
        if (profile === null || profile.provider_id !== binding.providerId || profile.revision !== binding.profileRevision ||
            profile.capability_hash !== binding.capabilityHash || profile.account_binding_hash !== binding.accountBindingHash ||
            profile.public_address.toLowerCase() !== operation.wallet || profile.drift.state !== "bound" ||
            profile.capability_snapshot.x402.mode !== binding.executionMode ||
            profile.capability_snapshot.x402.execution_owner !== binding.executionOwner ||
            profile.capability_snapshot.x402.retry_owner !== binding.retryOwner)
            throw new ApnError("APN_PROFILE_DRIFT", "The MetaMask signer no longer matches the frozen x402 profile.");
        const adapter = this.context.requireProviderRegistry().resolve(binding.providerId);
        if (adapter.provider_id !== binding.providerId || adapter.capabilities.x402.mode !== binding.executionMode ||
            adapter.x402Signer?.mode !== binding.executionMode)
            throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The frozen provider x402 signer is unavailable.");
        await adapter.reads.crossCheckAddress(operation.wallet);
        return adapter.x402Signer;
    }
}
export function providerAuthorizationBinding(operation) {
    const signer = operation.providerSigner;
    if (signer === undefined)
        corrupt("Provider x402 signer binding is missing.");
    return {
        profile: operation.profile,
        profileHash: operation.profileHash,
        operationId: operation.operationId,
        fingerprint: operation.fingerprint,
        wallet: operation.wallet,
        providerId: signer.providerId,
        profileRevision: signer.profileRevision,
        capabilityHash: signer.capabilityHash,
        accountBindingHash: signer.accountBindingHash,
    };
}
export function signingIntent(operation) {
    return {
        sender: operation.wallet,
        chainId: operation.chainId,
        token: operation.token,
        tokenDomain: {
            name: operation.selectedOffer.resolved.tokenName,
            version: operation.selectedOffer.resolved.tokenVersion,
        },
        authorization: {
            from: operation.authorization.from,
            to: operation.authorization.to,
            value: operation.authorization.value,
            validAfter: operation.authorization.validAfter,
            validBefore: operation.authorization.validBefore,
            nonce: operation.authorization.nonce,
        },
        humanIntent: `Authorize ${formatAtomic(operation.amountAtomic, 6)} USDC x402 payment to ${operation.payee} on Base; valid before ${operation.authorization.validBefore}.`,
    };
}
export function providerAuthorizationRequestHash(binding, intent) {
    return hashObject({ schemaVersion: "apn.provider-authorization-request.v1", binding, intent });
}
function corrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=provider-x402-authorization.js.map