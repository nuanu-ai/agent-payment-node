import { type JupiterV1ResolvedMaterial, type JupiterV1SemanticAccount } from "./v1-material.js";
import { type JupiterV1RouteId, type WhirlpoolV2NamedRoles } from "./v1-route-config.js";
export interface JupiterV1GuardedMaterial {
    readonly routeId?: JupiterV1RouteId;
    readonly namedRoles?: WhirlpoolV2NamedRoles;
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
/** Lamports beyond the exact input that one swap may spend or temporarily need: network fee (at most 20,000) and the
 * temporary wSOL account rent, with margin. It is the same overhead the original 1,000,000 / 6,000,000 lane used. */
export declare const JUPITER_V1_NATIVE_OVERHEAD_LAMPORTS = 5000000n;
export declare function jupiterV1MaximumNativeExpense(inputAtomic: string): string;
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
/** Old positional roles are accessed only behind the historical variant boundary. */
export declare function jupiterV1ProofRoles(g: JupiterV1GuardedMaterial): WhirlpoolV2NamedRoles;
