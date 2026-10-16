import { SOLANA_USDT } from "../../chain-policy.js";
import { swapMechanismDigest, SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207,
  ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296, ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM,
  WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";

/** Historical identity of the USDC→USDT route (Whirlpool deployed at slot 440170207). Existing operations only. */
export const ORCA_STABLE_MECHANISM_PIN_SLOT_440170207 = validateSwapMechanismPin({
  schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "orca_solana", networkFamily: "solana", chain: ORCA_SOLANA_CHAIN,
  protocolVersion: "whirlpool-stable-slot-440170207", constructorKind: "sdk",
  constructorIdentity: "apn.orca-whirlpool.stable-offline-preview", constructorVersion: "1.0.0",
  routerProgramIdentity: WHIRLPOOL_PROGRAM,
  auxiliaryContractProgramIdentities: [ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B,
    WHIRLPOOLS_CONFIG, USDC_MINT, SOLANA_USDT, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
  quoteSchemaVersion: "whirlpool-stable-onchain-state.exact-in-a-to-b.1",
  transactionSchemaVersion: "v0.compute-budget-optional-ata-usdc-usdt-preview.1",
  validationPolicyIdentity: "apn.orca.solana-usdc-usdt-untrusted-preview", validationPolicyVersion: "1.0.0",
});
export const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207 = validateSwapMechanismPin({
  ...ORCA_STABLE_MECHANISM_PIN_SLOT_440170207,
  constructorIdentity: "apn.orca-whirlpool.stable-guarded-candidate",
  transactionSchemaVersion: "v0.compute-budget-optional-ata-usdc-usdt-simulated.1",
  validationPolicyIdentity: "apn.orca.solana-usdc-usdt-guarded-candidate",
});
/** The historical registry; its digest stays exact so existing stable operations and their material still validate. */
export const ORCA_PROTOCOL_REGISTRY_SLOT_440170207 = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-routes.2026-09-28", pins: [ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207,
    ORCA_STABLE_MECHANISM_PIN_SLOT_440170207, ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207],
});

/** Historical generation pinned to the Whirlpool bytes deployed at slot 457152296 (APN 0.5.41 and 0.5.42). Existing operations only. */
export const ORCA_STABLE_MECHANISM_PIN_SLOT_457152296 = validateSwapMechanismPin({
  ...ORCA_STABLE_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-stable-slot-457152296",
});
export const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296 = validateSwapMechanismPin({
  ...ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-stable-slot-457152296",
});
/** The registry of that generation; its digest stays exact so its operations and material still validate. */
export const ORCA_PROTOCOL_REGISTRY_SLOT_457152296 = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-routes.2026-10-16", pins: [ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296,
    ORCA_STABLE_MECHANISM_PIN_SLOT_457152296, ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296],
});

/**
 * Identity of the USDC→USDT route. Its distinct constructor and transaction schema cannot select SOL→USDC. It names no
 * deployment: the Whirlpool program is accepted for any deployment by its pinned upgrade authority (pins.ts).
 */
export const ORCA_STABLE_MECHANISM_PIN = validateSwapMechanismPin({
  ...ORCA_STABLE_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-stable-upgrade-authority.1", validationPolicyVersion: "2.0.0",
});
export const ORCA_STABLE_MECHANISM_DIGEST = swapMechanismDigest(ORCA_STABLE_MECHANISM_PIN);

/** Separate owner opt-in for a chain priced and simulated guarded candidate. The preview pin never selects it. */
export const ORCA_STABLE_GUARDED_MECHANISM_PIN = validateSwapMechanismPin({
  ...ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-stable-upgrade-authority.1", validationPolicyVersion: "2.0.0",
});
export const ORCA_STABLE_GUARDED_MECHANISM_DIGEST = swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN);

/** Exact-digest selection works for both Orca mechanisms; family/chain selection is ambiguous and refuses. */
export const ORCA_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-routes.2026-10-17", pins: [ORCA_KEYLESS_MECHANISM_PIN, ORCA_STABLE_MECHANISM_PIN, ORCA_STABLE_GUARDED_MECHANISM_PIN],
});

/**
 * Every registered guarded generation with the registry that prepared it. New preparation, approval, marking and the
 * single send accept only the current digest; reading, observing, releasing and no-send recovery accept any generation.
 */
const ORCA_STABLE_GUARDED_GENERATIONS: readonly { readonly mechanismDigest: string; readonly registryDigest: string }[] = Object.freeze([
  Object.freeze({ mechanismDigest: ORCA_STABLE_GUARDED_MECHANISM_DIGEST, registryDigest: ORCA_PROTOCOL_REGISTRY.registryDigest }),
  Object.freeze({ mechanismDigest: swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296),
    registryDigest: ORCA_PROTOCOL_REGISTRY_SLOT_457152296.registryDigest }),
  Object.freeze({ mechanismDigest: swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207),
    registryDigest: ORCA_PROTOCOL_REGISTRY_SLOT_440170207.registryDigest }),
]);
export function isOrcaStableGuardedMechanismDigest(digest: string): boolean {
  return ORCA_STABLE_GUARDED_GENERATIONS.some((row) => row.mechanismDigest === digest);
}
/** The exact registry digest that a guarded generation was prepared under, or null for an unknown mechanism. */
export function orcaStableGuardedRegistryDigest(mechanismDigest: string): string | null {
  return ORCA_STABLE_GUARDED_GENERATIONS.find((row) => row.mechanismDigest === mechanismDigest)?.registryDigest ?? null;
}
