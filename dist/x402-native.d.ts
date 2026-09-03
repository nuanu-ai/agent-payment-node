import type { NativePort, NativeRequest } from "./ports.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export type PaymentIdentifierPosture = "absent" | "optional" | "required";
type FrozenAuthorization = Omit<X402OperationRecord["authorization"], "intentHash">;
type PublicAuthorization = Omit<FrozenAuthorization, "createdAt">;
export interface X402NativeCreatePayload {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly wallet: `0x${string}`;
    readonly chainId: "8453";
    readonly token: `0x${string}`;
    readonly resource: {
        readonly origin: string;
        readonly path: string;
        readonly urlHash: string;
    };
    readonly capAtomic: string;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly tokenDomain: {
        readonly name: string;
        readonly version: string;
    };
    readonly authorization: FrozenAuthorization;
    readonly paymentIdentifierPosture: PaymentIdentifierPosture;
    readonly paymentIdentifierValue?: string;
    readonly offerHash: string;
    readonly intentHash: string;
}
export interface X402NativeRecoveryPayload {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly wallet: `0x${string}`;
    readonly chainId: "8453";
    readonly token: `0x${string}`;
    readonly tokenDomain: {
        readonly name: string;
        readonly version: string;
    };
    readonly authorization: PublicAuthorization;
    readonly intentHash: string;
    readonly expectedSignatureHash?: string;
}
export interface X402NativeAuthorizationMaterial {
    readonly authorization: PublicAuthorization;
    readonly signature: `0x${string}`;
    readonly signatureHash: string;
}
export interface VerifiedX402PaymentMaterial {
    readonly native: X402NativeAuthorizationMaterial;
    readonly materialHash: string;
    readonly paymentPayloadHash: string;
    readonly paymentHeaderHash: string;
    readonly paymentHeader: string;
}
export declare function x402NativeRequest(requestId: string, operation: X402OperationRecord, kind: "create" | "get"): NativeRequest;
export declare function x402NativeCreatePayload(operation: X402OperationRecord): X402NativeCreatePayload;
export declare function x402NativeRecoveryPayload(operation: X402OperationRecord, expectedSignatureHash?: string): X402NativeRecoveryPayload;
export declare function requestX402Authorization(native: NativePort, request: NativeRequest, operation: X402OperationRecord): Promise<VerifiedX402PaymentMaterial>;
export declare function verifyAndConstructX402PaymentMaterial(value: unknown, operation: X402OperationRecord): Promise<VerifiedX402PaymentMaterial>;
export declare function isNativeNotFound(error: unknown): boolean;
export declare function isNativeExpired(error: unknown): boolean;
export declare function isTransientNativeFailure(error: unknown): boolean;
export {};
