import { type X402ChainText } from "./x402-network.js";
import type { Address, Hex } from "./model.js";
export interface X402Binding {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly wallet: Address;
    readonly chainId: X402ChainText;
    readonly token: Address;
    readonly tokenDomain: {
        readonly name: string;
        readonly version: string;
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
export declare function parseX402Create(payload: Readonly<Record<string, unknown>>): X402Create;
export declare function parseX402Recovery(payload: Readonly<Record<string, unknown>>): X402Binding & {
    readonly expectedSignatureHash?: string;
};
export declare function x402RecoveryBinding(value: X402Binding): X402Binding;
export declare function publicAuthorization(value: X402Binding["authorization"]): X402Binding["authorization"];
