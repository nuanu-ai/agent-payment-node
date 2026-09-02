import { type ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export interface X402PayerBinding {
    readonly wallet: `0x${string}`;
    readonly policy: ProfilePolicyBinding;
    readonly providerSigner?: NonNullable<X402OperationRecord["providerSigner"]>;
}
export declare function resolveX402Payer(context: RuntimeContext, profileHash: string): Promise<X402PayerBinding>;
