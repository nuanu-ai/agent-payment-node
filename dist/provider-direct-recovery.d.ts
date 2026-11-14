import type { OperationRecord, PlainProviderEffectReference, ProviderDirectBinding, ProviderEffectReference, SealedProviderEffectReference } from "./model.js";
import type { ProviderAdapterBundle } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import { type ProviderRequestReferencePort } from "./provider-request-reference-store.js";
import type { RuntimeContext } from "./runtime.js";
export type ProviderDirectRecoveryOutcome = {
    readonly disposition: "unchanged";
} | {
    readonly disposition: "acknowledged";
    readonly transactionHash: `0x${string}`;
} | {
    readonly disposition: "rejected";
    readonly reason: "provider_denied" | "provider_expired";
} | {
    readonly disposition: "ambiguous";
    readonly reason: string;
};
/**
 * One no-replay read of the stored provider request. A sealed request id is opened first; a seal that cannot be opened
 * throws its own precise refusal before the provider is asked anything, and the operation is not advanced.
 */
export declare function observeProviderDirectRequest(context: RuntimeContext, adapter: ProviderAdapterBundle, operation: OperationRecord & {
    readonly providerEffect: ProviderEffectReference;
}, waitSeconds?: number): Promise<ProviderDirectRecoveryOutcome>;
/** A reference that keeps its id: every reference 0.5.106 or earlier wrote, and a delegated send's (the APN operation id). */
export declare function createProviderEffectReference(recoveryToken: string, providerState: string): PlainProviderEffectReference;
/**
 * A provider's own request id for `operation` (its pending MFA request, or one the owner recovers), sealed before the
 * record names it: the record keeps only its hash. The caller holds the operation lock and the record has no reference yet.
 */
export declare function sealProviderEffectReference(references: ProviderRequestReferencePort, operation: OperationRecord, recoveryToken: string, providerState: string): Promise<SealedProviderEffectReference>;
/**
 * Whether a direct send returns a provider request id that APN seals: a provider-atomic send whose provider can be asked
 * to observe its requests (MetaMask Guard MFA). One condition decides both the readiness before approval and the seal
 * after the effect, so no request id is ever sealed without the wrapping secret having been read first.
 */
export declare function providerSealsRequests(context: RuntimeContext, binding: ProviderDirectBinding): boolean;
/**
 * The reference a pending direct result is kept as: a delegated send's id is the APN operation id, which every output
 * already names, and is kept as is; a provider's own request id is sealed. Null for a provider-atomic send whose provider
 * cannot be asked about a request: APN could never read it again, so no id is kept (the caller records
 * `provider_recovery_unavailable`).
 */
export declare function providerEffectReferenceFor(context: RuntimeContext, operation: OperationRecord, binding: ProviderDirectBinding, recoveryToken: string, providerState: string): Promise<ProviderEffectReference | null>;
/**
 * Before the owner is asked to approve a send whose request id will be sealed, the wrapping secret that seals it is read
 * (or created for a state that holds nothing sealed). A refusal leaves the operation awaiting approval, untouched.
 */
export declare function readyProviderEffectReferences(context: RuntimeContext, binding: ProviderDirectBinding): Promise<void>;
/** The stored request id: kept by a version 1 reference, or opened from the seal of a version 2 one. */
export declare function providerEffectRecoveryToken(context: RuntimeContext, operation: OperationRecord & {
    readonly providerEffect: ProviderEffectReference;
}): Promise<string>;
/** The hash output shows for a stored reference (`provider_request_reference_hash`), whichever version keeps it. */
export declare function providerEffectReferenceHash(providerId: string, reference: ProviderEffectReference): string;
/** Whether a stored reference names this request id; a sealed one is compared by hash and never opened. */
export declare function providerEffectNames(providerId: string, reference: ProviderEffectReference, recoveryToken: string): boolean;
export declare function canonicalProviderRecoveryToken(value: unknown): string;
export declare function sameFrozenProviderProfile(profile: ProviderProfileRecord, operation: OperationRecord, binding: ProviderDirectBinding): boolean;
