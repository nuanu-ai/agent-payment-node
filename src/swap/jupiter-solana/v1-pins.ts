import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { JUPITER_V6_PROGRAM, SOLANA_MAINNET_GENESIS, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM } from "./catalog.js";
export const JUPITER_V1_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export const JUPITER_V1_POOL = "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d";
export interface JupiterV1RegisteredProgramPin {
    readonly programId: string; readonly programDataAddress: string; readonly payloadHash: string;
    /** New snapshots also bind the complete loader header; historical pins remain exact. */
    readonly programDataHash?: string;
}
export const JUPITER_V1_RUNTIME_PROGRAM_PINS = Object.freeze([
    { programId: JUPITER_V6_PROGRAM, programDataAddress: "4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT", payloadHash: "899161c0e20b212c34671de0fbc2fcb7da4140fb837de431213e6ef6e321850f" },
    { programId: JUPITER_V1_WHIRLPOOL_PROGRAM, programDataAddress: "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD", payloadHash: "610b1e394973bd1b86de8afc983524bd21dea177e87bfae75ec289d4c350f9ae" },
    { programId: TOKEN_PROGRAM, programDataAddress: "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2", payloadHash: "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697" },
]);
export const JUPITER_V1_WHIRLPOOL_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "jupiter_solana", networkFamily: "solana", chain: `solana:${SOLANA_MAINNET_GENESIS}`, protocolVersion: "jup6-route-v1-whirlpool.1", constructorKind: "builder_api", constructorIdentity: "https://api.jup.ag/swap/v1/swap-instructions", constructorVersion: "1.0.0", routerProgramIdentity: JUPITER_V6_PROGRAM, auxiliaryContractProgramIdentities: [JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM], quoteSchemaVersion: "jupiter-v1-exact-in-whirlpool.1", transactionSchemaVersion: "v0-jup6-route-whirlpool-wrap-close.1", validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc", validationPolicyVersion: "1.0.0" }));
export const JUPITER_V1_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool.2026-10-07", pins: [JUPITER_V1_WHIRLPOOL_MECHANISM_PIN] });

/** Static-fee pool reviewed from public mainnet accounts at slot 454440585. */
export const JUPITER_V1_WHIRLPOOL_FP_POOL = "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q";
export const JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN,
 protocolVersion: "jup6-route-v1-whirlpool-fp.1",
 auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_FP_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM]),
 validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-fp" }));
export const JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-fp.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN] });

/** Independently captured on two mainnet origins. Runtime bytes only, not a source-build attestation. */
export const JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS: readonly JupiterV1RegisteredProgramPin[] = Object.freeze(
 JUPITER_V1_RUNTIME_PROGRAM_PINS.map(pin => Object.freeze(pin.programId === JUPITER_V6_PROGRAM ? {
  ...pin, payloadHash: "099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f",
  programDataHash: "3bd95cf0775979fdaed8a383474461d538a6ef040303f161abf9ed8c40dbc517"
 } : {...pin})));
/** Separate owner admission: historical FP policy cannot authorize upgraded executable bytes. */
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
 ...JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-fp-runtime.2",
 validationPolicyIdentity: "apn.jupiter-v1.runtime-099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f-sol-usdc-whirlpool-fp",
 validationPolicyVersion: "2.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
 registryVersion: "jupiter-v1-whirlpool-fp-runtime.2026-10-09", pins: [JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
 ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-runtime.2",
 validationPolicyIdentity: "apn.jupiter-v1.runtime-099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f-sol-usdc-whirlpool-83",
 validationPolicyVersion: "2.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
 registryVersion: "jupiter-v1-whirlpool-runtime.2026-10-09", pins: [JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN]
});

/** Additional finite route; the historical 83 mechanism and registry above remain unchanged. */
export const JUPITER_V1_WHIRLPOOL_V2_POOL = "Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e";
export const JUPITER_V1_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const JUPITER_V1_MEMO_PIN = Object.freeze({ programId: JUPITER_V1_MEMO_PROGRAM, loader: "BPFLoader2111111111111111111111111111111111", byteLength: 74800, payloadHash: "f520eaf096361abbb9639ea4dc3e5388a87b9330e121f476607b87c46ef67954" });
export const JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2.1", auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_V2_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V1_MEMO_PROGRAM]), quoteSchemaVersion: "jupiter-v1-exact-in-whirlpool-swap-v2.1", transactionSchemaVersion: "v0-jup6-route-whirlpool-swap-v2-wrap-close.1", validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-swap-v2" }));
export const JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN] });

/** A separately admitted pool. Historical mechanism and registry digests above stay exact. */
export const JUPITER_V1_WHIRLPOOL_4H_POOL = "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW";
export const JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN,
 protocolVersion: "jup6-route-v1-whirlpool-swap-v2-4h.1",
 auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_4H_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V1_MEMO_PROGRAM]),
 validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-swap-v2-4h" }));
export const JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2-4h.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN] });

export const JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS = Object.freeze([
    Object.freeze({programId: ASSOCIATED_TOKEN_PROGRAM, loader: "BPFLoader2111111111111111111111111111111111", payloadHash: "6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d"}),
    Object.freeze({programId: COMPUTE_BUDGET_PROGRAM, loader: "NativeLoader1111111111111111111111111111111", payloadHash: "005950c007e8e550a16beddf836f0082d26d197f5f645ff7c04a5c8d171cf8a1"}),
    Object.freeze({programId: SYSTEM_PROGRAM, loader: "NativeLoader1111111111111111111111111111111", payloadHash: "c94b792a6d8b25d3e53ea94d8b80111735ed80d6a7dc8deb937cd342707f5f03"}),
]);
