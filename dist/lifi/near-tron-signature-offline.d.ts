import type { Address, Hex } from "../model.js";
import { type NearTronOfflineBinding } from "./near-tron-offline.js";
export interface NearTronSignatureContext {
    /** Must be independently established from the currently installed facet. */
    readonly backendSigner: Address;
    /** Must be independently established as the deployed Diamond on this chain. */
    readonly diamond: Address;
    readonly chainId: 8453;
    /** Trusted observation time; quote metadata is not a time source. */
    readonly nowUnixSeconds: string;
}
export interface NearTronSignatureProof {
    readonly kind: "offline_near_tron_signature_proof";
    readonly executionAdmitted: false;
    readonly bridgeCompletion: false;
    readonly recoveredSigner: Address;
    readonly expectedBackendSigner: Address;
    readonly digest: Hex;
    readonly diamond: Address;
    readonly chainId: 8453;
    readonly quoteId: Hex;
    readonly deadline: string;
}
/** Proves that the saved calldata signature recovers a caller-supplied signer for this exact domain and payload. */
export declare function verifyNearBaseTronSignatureOffline(value: unknown, binding: NearTronOfflineBinding, context: NearTronSignatureContext): Promise<NearTronSignatureProof>;
