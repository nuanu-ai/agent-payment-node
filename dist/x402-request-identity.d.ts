import { type X402HttpRequestV1 } from "./x402-http-request.js";
import type { X402OperationRecord } from "./x402-state-model.js";
/** Request and fingerprint identities of a standard x402 operation (moved from x402-state-model.ts, unchanged). */
export declare function x402RequestHash(input: {
    readonly profile: string;
    readonly canonicalUrl: string;
    readonly capAtomic: string;
    readonly chainId?: number;
    readonly token?: string;
    readonly httpRequest?: X402HttpRequestV1;
}): string;
export declare function x402Fingerprint(input: Pick<X402OperationRecord, "kind" | "profile" | "operationId" | "resource" | "chainId" | "network" | "token" | "capAtomic" | "selectedOffer" | "wallet" | "paymentIdentifier" | "providerSigner" | "delegatedMaterial">): string;
