import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { JUPITER_V6_PROGRAM, SOLANA_MAINNET_GENESIS, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM } from "./catalog.js";
export const JUPITER_V1_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export const JUPITER_V1_POOL = "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d";
export const JUPITER_V1_RUNTIME_PROGRAM_PINS = Object.freeze([
    { programId: JUPITER_V6_PROGRAM, programDataAddress: "4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT", payloadHash: "899161c0e20b212c34671de0fbc2fcb7da4140fb837de431213e6ef6e321850f" },
    { programId: JUPITER_V1_WHIRLPOOL_PROGRAM, programDataAddress: "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD", payloadHash: "610b1e394973bd1b86de8afc983524bd21dea177e87bfae75ec289d4c350f9ae" },
    { programId: TOKEN_PROGRAM, programDataAddress: "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2", payloadHash: "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697" },
]);
export const JUPITER_V1_WHIRLPOOL_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "jupiter_solana", networkFamily: "solana", chain: `solana:${SOLANA_MAINNET_GENESIS}`, protocolVersion: "jup6-route-v1-whirlpool.1", constructorKind: "builder_api", constructorIdentity: "https://api.jup.ag/swap/v1/swap-instructions", constructorVersion: "1.0.0", routerProgramIdentity: JUPITER_V6_PROGRAM, auxiliaryContractProgramIdentities: [JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM], quoteSchemaVersion: "jupiter-v1-exact-in-whirlpool.1", transactionSchemaVersion: "v0-jup6-route-whirlpool-wrap-close.1", validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc", validationPolicyVersion: "1.0.0" }));
export const JUPITER_V1_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool.2026-10-07", pins: [JUPITER_V1_WHIRLPOOL_MECHANISM_PIN] });
//# sourceMappingURL=v1-pins.js.map