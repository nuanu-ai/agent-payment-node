import { SOLANA_USDT } from "../../chain-policy.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, validateSwapMechanismPin, type SwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry, type SwapProtocolRegistry } from "../protocol-registry.js";
import { swapRouteOf, type SwapRouteAdmission } from "../route-admission.js";
import {
  ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207,
  ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296, ORCA_KEYLESS_PROTOCOL_REGISTRY, ORCA_POOL_TICK_SPACING, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT,
  ORCA_SOLANA_CHAIN, ORCA_USDC_VAULT, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG, WSOL_MINT,
} from "./pins.js";

/**
 * The USDC/USDT Whirlpool: mint A is USDC, mint B is USDT, tick spacing 1, a static fee tier (no adaptive-fee oracle),
 * owned by the pinned Whirlpool program. Its fee rate is read from the pool account at every quote.
 */
export const ORCA_USDC_USDT_POOL = "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4" as const;
export const ORCA_USDC_USDT_VAULT_A = "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL" as const;
export const ORCA_USDC_USDT_VAULT_B = "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9" as const;

/**
 * USDC to USDT through the keyless Orca route. Its router and contracts are exactly those of the former stable USDC/USDT
 * lane (APN 0.5.45 and earlier), so a policy that admitted that route, by route or by its mechanism pin, admits this one.
 */
export const ORCA_USDC_USDT_MECHANISM_PIN: SwapMechanismPin = validateSwapMechanismPin({
  schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "orca_solana", networkFamily: "solana", chain: ORCA_SOLANA_CHAIN,
  protocolVersion: "whirlpool-upgrade-authority.1", constructorKind: "sdk", constructorIdentity: "apn.orca-whirlpool.local-instruction-builder",
  constructorVersion: "1.0.0", routerProgramIdentity: WHIRLPOOL_PROGRAM,
  auxiliaryContractProgramIdentities: [ORCA_USDC_USDT_POOL, ORCA_USDC_USDT_VAULT_A, ORCA_USDC_USDT_VAULT_B, WHIRLPOOLS_CONFIG, USDC_MINT,
    SOLANA_USDT, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
  quoteSchemaVersion: "whirlpool-onchain-state.exact-in-a-to-b.1", transactionSchemaVersion: "v0.compute-budget-ata-token-swap.1",
  validationPolicyIdentity: "apn.orca.solana-usdc-usdt-keyless", validationPolicyVersion: "1.0.0",
});
/** Official identity only. Owners must still admit USDC and USDT with this route under a sealed policy. */
export const ORCA_USDC_USDT_PROTOCOL_REGISTRY: SwapProtocolRegistry = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-keyless-usdc-usdt.2026-10-17", pins: [ORCA_USDC_USDT_MECHANISM_PIN],
});

export type OrcaPoolId = "sol-usdc" | "usdc-usdt";
/**
 * One pinned Whirlpool of the keyless Orca route. Every swap is exact input from token A to token B (the local swap math
 * ports only that direction). `nativeWrap: "a"` means token A is wrapped SOL: the input is native SOL, wrapped and
 * unwrapped inside the transaction. `null` means both sides are classic SPL token accounts of the owner.
 */
export interface OrcaPoolConfig {
  readonly id: OrcaPoolId;
  readonly pool: string; readonly mintA: string; readonly mintB: string; readonly vaultA: string; readonly vaultB: string;
  readonly tickSpacing: number;
  readonly nativeWrap: "a" | null;
  readonly symbolA: string; readonly symbolB: string; readonly decimalsA: number; readonly decimalsB: number;
  /** The current lane identity: new quotes, approvals and signatures use only this. */
  readonly mechanismPin: SwapMechanismPin;
  readonly protocolRegistry: SwapProtocolRegistry;
  /** Every registered generation of this lane, current first: existing operations stay readable and observable. */
  readonly mechanismDigests: readonly string[];
}

export const ORCA_POOLS: Readonly<Record<OrcaPoolId, OrcaPoolConfig>> = Object.freeze({
  "sol-usdc": Object.freeze({ id: "sol-usdc", pool: ORCA_SOL_USDC_POOL, mintA: WSOL_MINT, mintB: USDC_MINT, vaultA: ORCA_SOL_VAULT,
    vaultB: ORCA_USDC_VAULT, tickSpacing: ORCA_POOL_TICK_SPACING, nativeWrap: "a", symbolA: "SOL", symbolB: "USDC", decimalsA: 9,
    decimalsB: 6, mechanismPin: ORCA_KEYLESS_MECHANISM_PIN, protocolRegistry: ORCA_KEYLESS_PROTOCOL_REGISTRY,
    mechanismDigests: Object.freeze([ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296,
      ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207].map((pin) => swapMechanismDigest(pin))) }),
  "usdc-usdt": Object.freeze({ id: "usdc-usdt", pool: ORCA_USDC_USDT_POOL, mintA: USDC_MINT, mintB: SOLANA_USDT,
    vaultA: ORCA_USDC_USDT_VAULT_A, vaultB: ORCA_USDC_USDT_VAULT_B, tickSpacing: 1, nativeWrap: null, symbolA: "USDC", symbolB: "USDT",
    decimalsA: 6, decimalsB: 6, mechanismPin: ORCA_USDC_USDT_MECHANISM_PIN, protocolRegistry: ORCA_USDC_USDT_PROTOCOL_REGISTRY,
    mechanismDigests: Object.freeze([swapMechanismDigest(ORCA_USDC_USDT_MECHANISM_PIN)]) }),
});
export const ORCA_POOL_IDS: readonly OrcaPoolId[] = Object.freeze(["sol-usdc", "usdc-usdt"]);

/** The route identity an owner admits for a pool (apn.swap-route.v1). */
export function orcaPoolRoute(pool: OrcaPoolConfig): SwapRouteAdmission { return swapRouteOf(pool.mechanismPin); }
/** The pool whose lane, in any registered generation, names this mechanism; null outside the keyless Orca route. */
export function orcaPoolOfMechanism(digest: string): OrcaPoolConfig | null {
  return ORCA_POOL_IDS.map((id) => ORCA_POOLS[id]).find((pool) => pool.mechanismDigests.includes(digest)) ?? null;
}
/** Any registered keyless generation of any pool: existing operations stay readable and observable after a program upgrade. */
export function isOrcaKeylessMechanismDigest(digest: string): boolean { return orcaPoolOfMechanism(digest) !== null; }
