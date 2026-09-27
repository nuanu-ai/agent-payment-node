import { SOLANA_USDT } from "../../chain-policy.js";
import { swapMechanismDigest, SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_KEYLESS_MECHANISM_PIN, ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";
/** Identity of the USDC→USDT route. Its distinct constructor and transaction schema cannot select SOL→USDC. */
export const ORCA_STABLE_MECHANISM_PIN = validateSwapMechanismPin({
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
export const ORCA_STABLE_MECHANISM_DIGEST = swapMechanismDigest(ORCA_STABLE_MECHANISM_PIN);
/** Exact-digest selection works for both Orca mechanisms; family/chain selection is ambiguous and refuses. */
export const ORCA_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "orca-whirlpool-routes.2026-09-27", pins: [ORCA_KEYLESS_MECHANISM_PIN, ORCA_STABLE_MECHANISM_PIN],
});
//# sourceMappingURL=stable-mechanism.js.map