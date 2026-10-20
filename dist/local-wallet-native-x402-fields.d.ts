import { type X402ChainText } from "./x402-network.js";
import type { Address, Hex } from "./model.js";
export interface X402Binding {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly wallet: Address;
    readonly chainId: X402ChainText;
    readonly token: Address;
    /** EIP-3009: the token's EIP-712 domain. Absent on a Permit2 witness transfer. */
    readonly tokenDomain?: {
        readonly name: string;
        readonly version: string;
    };
    /** Permit2 witness transfer: the seller-sponsored exact-amount EIP-2612 permit to Permit2, or null. */
    readonly permit2?: {
        readonly eip2612: {
            readonly name: string;
            readonly version: string;
            readonly nonce: string;
        } | null;
    };
    readonly authorization: {
        readonly from: Address;
        readonly to: Address;
        readonly value: string;
        readonly validAfter: "0";
        readonly validBefore: string;
        readonly nonce: Hex;
    };
    readonly intentHash: string;
}
export interface X402Create extends X402Binding {
    readonly payee: Address;
    readonly amountAtomic: string;
    readonly capAtomic: string;
    readonly authorization: X402Binding["authorization"] & {
        readonly createdAt: string;
    };
}
export type X402CustodyMethod = "eip3009" | "permit2";
export declare function parseX402Create(payload: Readonly<Record<string, unknown>>, method?: X402CustodyMethod): X402Create;
export declare function parseX402Recovery(payload: Readonly<Record<string, unknown>>, method?: X402CustodyMethod): X402Binding & {
    readonly expectedSignatureHash?: string;
};
export declare function x402RecoveryBinding(value: X402Binding): X402Binding;
export declare function publicAuthorization(value: X402Binding["authorization"]): X402Binding["authorization"];
