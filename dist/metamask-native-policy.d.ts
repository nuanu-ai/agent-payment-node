export interface MetaMaskNativePolicyVariant {
    readonly vendorPolicyHash: string;
    readonly policyBytes: 866 | 945;
    readonly allowsOptimism: boolean;
}
/** Pure policy identities, never an owner certificate, scope issuer or public financial callback. */
export declare function metaMaskNativePolicyVariants(payer: string): readonly MetaMaskNativePolicyVariant[];
export declare function metaMaskNativePolicyAllowsChain(policy: {
    readonly vendorPolicyHash: string;
    readonly policyBytes: number;
}, chainId: number, payer: string): boolean;
