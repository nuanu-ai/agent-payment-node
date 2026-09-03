import { type ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
import type { X402PaymentMaterialPort } from "./provider-ports.js";
export interface X402PayerBinding {
    readonly wallet: `0x${string}`;
    readonly policy: ProfilePolicyBinding;
    readonly transferMethod: "eip3009" | "erc7710";
    readonly providerSigner?: NonNullable<X402OperationRecord["providerSigner"]>;
    readonly delegated?: {
        readonly profileRevision: number;
        readonly capabilityHash: string;
        readonly accountBindingHash: string;
        readonly port: X402PaymentMaterialPort;
    };
}
export declare function resolveX402Payer(context: RuntimeContext, profileHash: string): Promise<X402PayerBinding>;
