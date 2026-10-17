import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
import { type SwapRouteAdmission } from "../route-admission.js";
/**
 * The USDC/USDT Whirlpool: mint A is USDC, mint B is USDT, tick spacing 1, a static fee tier (no adaptive-fee oracle),
 * owned by the pinned Whirlpool program. Its fee rate is read from the pool account at every quote.
 */
export declare const ORCA_USDC_USDT_POOL: "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4";
export declare const ORCA_USDC_USDT_VAULT_A: "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL";
export declare const ORCA_USDC_USDT_VAULT_B: "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9";
/**
 * USDC to USDT through the keyless Orca route. Its router and contracts are exactly those of the former stable USDC/USDT
 * lane (APN 0.5.45 and earlier), so a policy that admitted that route, by route or by its mechanism pin, admits this one.
 */
export declare const ORCA_USDC_USDT_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit USDC and USDT with this route under a sealed policy. */
export declare const ORCA_USDC_USDT_PROTOCOL_REGISTRY: SwapProtocolRegistry;
export type OrcaPoolId = "sol-usdc" | "usdc-usdt";
/**
 * One pinned Whirlpool of the keyless Orca route. Every swap is exact input from token A to token B (the local swap math
 * ports only that direction). `nativeWrap: "a"` means token A is wrapped SOL: the input is native SOL, wrapped and
 * unwrapped inside the transaction. `null` means both sides are classic SPL token accounts of the owner.
 */
export interface OrcaPoolConfig {
    readonly id: OrcaPoolId;
    readonly pool: string;
    readonly mintA: string;
    readonly mintB: string;
    readonly vaultA: string;
    readonly vaultB: string;
    readonly tickSpacing: number;
    readonly nativeWrap: "a" | null;
    readonly symbolA: string;
    readonly symbolB: string;
    readonly decimalsA: number;
    readonly decimalsB: number;
    /** The current lane identity: new quotes, approvals and signatures use only this. */
    readonly mechanismPin: SwapMechanismPin;
    readonly protocolRegistry: SwapProtocolRegistry;
    /** Every registered generation of this lane, current first: existing operations stay readable and observable. */
    readonly mechanismDigests: readonly string[];
}
export declare const ORCA_POOLS: Readonly<Record<OrcaPoolId, OrcaPoolConfig>>;
export declare const ORCA_POOL_IDS: readonly OrcaPoolId[];
/** The route identity an owner admits for a pool (apn.swap-route.v1). */
export declare function orcaPoolRoute(pool: OrcaPoolConfig): SwapRouteAdmission;
/** The pool whose lane, in any registered generation, names this mechanism; null outside the keyless Orca route. */
export declare function orcaPoolOfMechanism(digest: string): OrcaPoolConfig | null;
/** Any registered keyless generation of any pool: existing operations stay readable and observable after a program upgrade. */
export declare function isOrcaKeylessMechanismDigest(digest: string): boolean;
