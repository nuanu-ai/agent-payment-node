import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { BPF_LOADER_2, NATIVE_LOADER, UPGRADEABLE_LOADER } from "../solana-program-authority.js";
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
/** Static-fee pool reviewed from public mainnet accounts at slot 454440585. */
export const JUPITER_V1_WHIRLPOOL_FP_POOL = "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q";
export const JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN,
    protocolVersion: "jup6-route-v1-whirlpool-fp.1",
    auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_FP_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM]),
    validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-fp" }));
export const JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-fp.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN] });
/** Independently captured on two mainnet origins. Runtime bytes only, not a source-build attestation. */
export const JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS = Object.freeze(JUPITER_V1_RUNTIME_PROGRAM_PINS.map(pin => Object.freeze(pin.programId === JUPITER_V6_PROGRAM ? {
    ...pin, payloadHash: "099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f",
    programDataHash: "3bd95cf0775979fdaed8a383474461d538a6ef040303f161abf9ed8c40dbc517"
} : { ...pin })));
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
/** Memo and the fixed setup programs cannot be upgraded; their loader is the pin. */
export const JUPITER_V1_MEMO_PIN = Object.freeze({ programId: JUPITER_V1_MEMO_PROGRAM, loader: "BPFLoader2111111111111111111111111111111111" });
export const JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2.1", auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_V2_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V1_MEMO_PROGRAM]), quoteSchemaVersion: "jupiter-v1-exact-in-whirlpool-swap-v2.1", transactionSchemaVersion: "v0-jup6-route-whirlpool-swap-v2-wrap-close.1", validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-swap-v2" }));
export const JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN] });
/** A separately admitted pool. Historical mechanism and registry digests above stay exact. */
export const JUPITER_V1_WHIRLPOOL_4H_POOL = "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW";
export const JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({ ...JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN,
    protocolVersion: "jup6-route-v1-whirlpool-swap-v2-4h.1",
    auxiliaryContractProgramIdentities: Object.freeze([JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_WHIRLPOOL_4H_POOL, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V1_MEMO_PROGRAM]),
    validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc-whirlpool-swap-v2-4h" }));
export const JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2-4h.2026-10-08", pins: [JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN] });
/** Additive upgraded generations; historical SwapV2 admissions do not authorize these bytes. */
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2-runtime.2",
    validationPolicyIdentity: "apn.jupiter-v1.runtime-099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f-sol-usdc-whirlpool-swap-v2-esv",
    validationPolicyVersion: "2.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-swap-v2-esv-runtime.2026-10-11", pins: [JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2-4h-runtime.2",
    validationPolicyIdentity: "apn.jupiter-v1.runtime-099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f-sol-usdc-whirlpool-swap-v2-4h",
    validationPolicyVersion: "2.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-swap-v2-4h-runtime.2026-10-11", pins: [JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS = Object.freeze([
    Object.freeze({ programId: ASSOCIATED_TOKEN_PROGRAM, loader: "BPFLoader2111111111111111111111111111111111" }),
    Object.freeze({ programId: COMPUTE_BUDGET_PROGRAM, loader: "NativeLoader1111111111111111111111111111111" }),
    Object.freeze({ programId: SYSTEM_PROGRAM, loader: "NativeLoader1111111111111111111111111111111" }),
]);
/**
 * Whirlpool upgraded at slot 457152296 (2026-10-15 07:22:05 UTC, Squads vault GwH3Hiv5…, transaction 2Z156jvt…).
 * Two mainnet origins returned identical ProgramData bytes. Runtime bytes only, not a source-build attestation.
 * The JUP6 and Token entries are the registered 099da3 snapshot; only the shared Whirlpool executable pin changes.
 */
export const JUPITER_V1_WHIRLPOOL_C422B2_PAYLOAD_HASH = "c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f";
export const JUPITER_V1_WHIRLPOOL_C422B2_PROGRAM_DATA_HASH = "a49ebc534880f4aaf525b5fd1504aed6223928bdbbea6c83d40473eb17abd04e";
export const JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS = Object.freeze(JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS.map(pin => Object.freeze(pin.programId === JUPITER_V1_WHIRLPOOL_PROGRAM ? {
    ...pin, payloadHash: JUPITER_V1_WHIRLPOOL_C422B2_PAYLOAD_HASH, programDataHash: JUPITER_V1_WHIRLPOOL_C422B2_PROGRAM_DATA_HASH
} : { ...pin })));
const C422B2_POLICY = "runtime-099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f-whirlpool-c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f";
/** Separate owner admissions: 099da3-generation policies name the previous Whirlpool bytes and cannot authorize these. */
export const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-runtime.3",
    validationPolicyIdentity: `apn.jupiter-v1.${C422B2_POLICY}-sol-usdc-whirlpool-83`, validationPolicyVersion: "3.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-runtime-c422b2.2026-10-16", pins: [JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-fp-runtime.3",
    validationPolicyIdentity: `apn.jupiter-v1.${C422B2_POLICY}-sol-usdc-whirlpool-fp`, validationPolicyVersion: "3.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-fp-runtime-c422b2.2026-10-16", pins: [JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2-runtime.3",
    validationPolicyIdentity: `apn.jupiter-v1.${C422B2_POLICY}-sol-usdc-whirlpool-swap-v2-esv`, validationPolicyVersion: "3.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-swap-v2-esv-runtime-c422b2.2026-10-16", pins: [JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_MECHANISM_PIN]
});
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_MECHANISM_PIN = Object.freeze(validateSwapMechanismPin({
    ...JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, protocolVersion: "jup6-route-v1-whirlpool-swap-v2-4h-runtime.3",
    validationPolicyIdentity: `apn.jupiter-v1.${C422B2_POLICY}-sol-usdc-whirlpool-swap-v2-4h`, validationPolicyVersion: "3.0.0"
}));
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "jupiter-v1-whirlpool-swap-v2-4h-runtime-c422b2.2026-10-16", pins: [JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_MECHANISM_PIN]
});
/**
 * Current route set (owner decision, phase 2): one mechanism per pool that names no executable bytes, so a routine
 * JUP6 or Whirlpool upgrade changes nothing. What is pinned instead is each upgradeable program's ProgramData address and
 * upgrade authority, read from 45-byte loader headers (2026-10-16, slot 457686204): JUP6 CvQZZ23q… (deployed at slot
 * 454465850), Whirlpool's Squads v4 vault GwH3Hiv5… (deployed at slot 457152296), and SPL Token, whose authority was
 * removed. A different authority refuses; a new deployment slot alone is accepted.
 */
export const JUPITER_V1_PROGRAM_AUTHORITIES = Object.freeze([
    { role: "jupiter_v6_program", programId: JUPITER_V6_PROGRAM, loader: UPGRADEABLE_LOADER, programDataAddress: "4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT",
        upgradeAuthority: "CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ" },
    { role: "whirlpool_program", programId: JUPITER_V1_WHIRLPOOL_PROGRAM, loader: UPGRADEABLE_LOADER, programDataAddress: "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD",
        upgradeAuthority: "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV" },
    { role: "spl_token_program", programId: TOKEN_PROGRAM, loader: UPGRADEABLE_LOADER, programDataAddress: "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2",
        upgradeAuthority: null },
].map(pin => Object.freeze(pin)));
/** Programs that can never be upgraded: BPFLoader2 or native. Their loader is the pin. */
export const JUPITER_V1_IMMUTABLE_PROGRAMS = Object.freeze([
    { role: "associated_token_program", programId: ASSOCIATED_TOKEN_PROGRAM, loader: BPF_LOADER_2 },
    { role: "system_program", programId: SYSTEM_PROGRAM, loader: NATIVE_LOADER },
    { role: "compute_budget_program", programId: COMPUTE_BUDGET_PROGRAM, loader: NATIVE_LOADER },
    { role: "memo_program", programId: JUPITER_V1_MEMO_PROGRAM, loader: BPF_LOADER_2 },
].map(pin => Object.freeze(pin)));
function authorityPinned(pin, protocolVersion, pool) {
    return Object.freeze(validateSwapMechanismPin({ ...pin, protocolVersion, validationPolicyIdentity: `apn.jupiter-v1.upgrade-authority-sol-usdc-whirlpool-${pool}`,
        validationPolicyVersion: "4.0.0" }));
}
export const JUPITER_V1_83_MECHANISM_PIN = authorityPinned(JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, "jup6-route-v1-whirlpool.upgrade-authority", "83");
export const JUPITER_V1_FP_MECHANISM_PIN = authorityPinned(JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, "jup6-route-v1-whirlpool-fp.upgrade-authority", "fp");
export const JUPITER_V1_ESV_MECHANISM_PIN = authorityPinned(JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, "jup6-route-v1-whirlpool-swap-v2.upgrade-authority", "swap-v2-esv");
export const JUPITER_V1_4H_MECHANISM_PIN = authorityPinned(JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, "jup6-route-v1-whirlpool-swap-v2-4h.upgrade-authority", "swap-v2-4h");
export const JUPITER_V1_83_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-83.2026-10-17", pins: [JUPITER_V1_83_MECHANISM_PIN] });
export const JUPITER_V1_FP_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-fp.2026-10-17", pins: [JUPITER_V1_FP_MECHANISM_PIN] });
export const JUPITER_V1_ESV_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2-esv.2026-10-17", pins: [JUPITER_V1_ESV_MECHANISM_PIN] });
export const JUPITER_V1_4H_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "jupiter-v1-whirlpool-swap-v2-4h.2026-10-17", pins: [JUPITER_V1_4H_MECHANISM_PIN] });
//# sourceMappingURL=v1-pins.js.map