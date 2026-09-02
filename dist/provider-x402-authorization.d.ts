import type { ProviderAuthorizationBinding, ProviderAuthorizationStorePort } from "./encrypted-provider-authorization-store.js";
import type { X402SigningIntent } from "./provider-ports.js";
import type { RuntimeContext } from "./runtime.js";
import { type VerifiedX402PaymentMaterial } from "./x402-native.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export type ProviderAuthorizationOutcome = {
    readonly disposition: "signed";
    readonly material: VerifiedX402PaymentMaterial;
} | {
    readonly disposition: "pending";
} | {
    readonly disposition: "rejected";
} | {
    readonly disposition: "ambiguous";
};
export declare class ProviderX402AuthorizationService {
    private readonly context;
    private readonly store;
    constructor(context: RuntimeContext, store: ProviderAuthorizationStorePort);
    authorize(operation: X402OperationRecord, kind: "create" | "get"): Promise<ProviderAuthorizationOutcome>;
    private continueExisting;
    private acceptOutcome;
    private verified;
    private requiredSigner;
}
export declare function providerAuthorizationBinding(operation: X402OperationRecord): ProviderAuthorizationBinding;
export declare function signingIntent(operation: X402OperationRecord): X402SigningIntent;
export declare function providerAuthorizationRequestHash(binding: ProviderAuthorizationBinding, intent: X402SigningIntent): string;
