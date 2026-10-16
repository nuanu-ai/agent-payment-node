import { type X402PolicyNetwork } from "./x402-network.js";
import type { EvmChainId } from "./evm-asset.js";
import type { Address, WalletRecord } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export declare const PROFILE_POLICY_VERSION: "apn.profile-policy.v1";
export interface ProfilePolicyBinding {
    readonly x402Network?: X402PolicyNetwork;
    readonly profile: string;
    readonly profileHash: string;
    readonly walletAddress: Address;
    readonly walletBindingHash: string;
}
export interface ProfilePolicyRecord extends ProfilePolicyBinding {
    readonly schemaVersion: typeof PROFILE_POLICY_VERSION;
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
    /**
     * Optional owner payee pin for x402 (1-16 canonical non-zero EVM addresses). Absent means this policy does not restrict
     * payees: the payee stays the seller's offer, shown and bound into the authorization. Checked at prepare, before
     * signing and before the first paid request.
     */
    readonly x402Payees?: readonly Address[];
    readonly approvedAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export interface ProfilePolicySetInput {
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
    /** Omitted keeps the current pin; null removes it (payees not restricted); a list sets it. */
    readonly x402Payees?: readonly string[] | null;
}
export declare const MAX_X402_PAYEES = 16;
/** CLI spelling that removes the pin (`--x402-payees unrestricted`). */
export declare const X402_PAYEES_UNRESTRICTED = "unrestricted";
/** The canonical pin a request sets: null when it removes the pin. */
export declare function canonicalX402Payees(value: readonly string[] | null): readonly Address[] | null;
/** 1-16 unique non-zero EVM addresses in checksum form, or null when the list is invalid. `exact` refuses other spellings. */
export declare function x402PayeeList(value: unknown, exact?: boolean): readonly Address[] | null;
/** Seller offers whose payee the optional pin admits (all of them without a pin); none admitted refuses before selection. */
export declare function x402PayeeAdmittedOffers<T extends {
    readonly payTo: string;
}>(policy: Pick<ProfilePolicyRecord, "x402Payees">, offers: readonly T[]): readonly T[];
/** Refuse a payee outside the profile's optional x402 payee pin. Returns when admitted or when the policy has no pin. */
export declare function assertX402PayeeAdmitted(policy: Pick<ProfilePolicyRecord, "x402Payees">, payee: string): void;
export interface ProfilePolicyPort {
    load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null>;
    set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord>;
}
export declare function policyBinding(wallet: WalletRecord | ProviderProfileRecord): ProfilePolicyBinding;
export declare function canonicalPolicyInput(input: ProfilePolicySetInput): ProfilePolicySetInput;
export declare function sealProfilePolicy(value: Omit<ProfilePolicyRecord, "integrityHash">): ProfilePolicyRecord;
export declare function validateProfilePolicy(value: unknown, binding?: ProfilePolicyBinding): ProfilePolicyRecord;
export declare function publicProfilePolicy(profile: string, policy: ProfilePolicyRecord | null, chainId?: EvmChainId): unknown;
export declare const REDUCE_EXCESS_ACTION = "Reduce excess manually only to an independently verified address; APN does not sweep or refund automatically.";
export interface FundingPosture {
    readonly classification: string;
    readonly next_actions: readonly string[];
    readonly [field: string]: unknown;
}
export declare function fundingPosture(usdcAtomic: string, ethAtomic: string, policy: ProfilePolicyRecord | null): FundingPosture;
export declare function requireProfilePolicy(policy: ProfilePolicyRecord | null): ProfilePolicyRecord;
export declare function effectiveX402Cap(policy: ProfilePolicyRecord, callerCapInput?: string): string;
export declare function assertUnattendedX402Balance(policy: ProfilePolicyRecord, usdcAtomic: string): void;
export declare function policyIncrease(current: ProfilePolicyRecord | null, next: ProfilePolicySetInput): boolean;
