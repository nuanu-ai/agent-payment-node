import { ApnError } from "./errors.js";
import { capabilityHash } from "./provider-profile.js";
export class ProviderRegistry {
    factories;
    adapters = new Map();
    constructor(registrations) {
        const byId = new Map();
        for (const registration of registrations) {
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(registration.provider_id) || byId.has(registration.provider_id)) {
                throw new ApnError("APN_INTERNAL", "Provider registry composition is invalid.");
            }
            byId.set(registration.provider_id, registration.create);
        }
        this.factories = byId;
    }
    resolve(providerId) {
        const cached = this.adapters.get(providerId);
        if (cached !== undefined)
            return cached;
        const create = this.factories.get(providerId);
        if (create === undefined) {
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "The requested wallet provider is not registered.", { retryable: false });
        }
        const adapter = create();
        if (adapter.provider_id !== providerId)
            throw new ApnError("APN_INTERNAL", "Provider registry composition is invalid.");
        capabilityHash(adapter.capabilities);
        this.adapters.set(providerId, adapter);
        return adapter;
    }
}
//# sourceMappingURL=provider-registry.js.map