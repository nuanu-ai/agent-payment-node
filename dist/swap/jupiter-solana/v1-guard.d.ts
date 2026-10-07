import { type JupiterV1ResolvedMaterial, type JupiterV1SemanticAccount } from "./v1-material.js";
export interface JupiterV1GuardedMaterial {
    readonly material: JupiterV1ResolvedMaterial;
    readonly payer: string;
    readonly sourceTokenAccount: string;
    readonly destinationTokenAccount: string;
    readonly pool: string;
    readonly nativeAccounts: readonly string[];
    readonly inputAtomic: string;
    readonly quotedOutputAtomic: string;
    readonly instructionMinimumOutputAtomic: string;
    readonly quotedMinimumOutputAtomic: string;
    readonly minimumRoundingDeltaAtomic: string;
    readonly maximumNativeExpenseLamports: string;
    readonly admissionDigest: string;
}
export declare function reject(message: string): never;
export declare function semanticAccount(material: JupiterV1ResolvedMaterial, key: string): JupiterV1SemanticAccount;
export declare function tokenState(a: JupiterV1SemanticAccount, mint: string, owner: string): {
    amount: bigint;
    nativeRent: bigint | null;
};
export declare function guardJupiterV1WhirlpoolMaterial(material: JupiterV1ResolvedMaterial, options?: {
    readonly now?: number;
    readonly deadline?: string;
}): Promise<JupiterV1GuardedMaterial>;
export declare function validateJupiterV1GuardedMaterial(guarded: JupiterV1GuardedMaterial, requireFresh?: boolean): Promise<void>;
