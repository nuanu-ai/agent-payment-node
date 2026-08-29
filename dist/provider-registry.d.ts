import type { ProviderAdapterBundle, ProviderRegistryPort } from "./provider-ports.js";
export declare class ProviderRegistry implements ProviderRegistryPort {
    private readonly factories;
    private readonly adapters;
    constructor(registrations: readonly {
        readonly provider_id: string;
        readonly create: () => ProviderAdapterBundle;
    }[]);
    resolve(providerId: string): ProviderAdapterBundle;
}
