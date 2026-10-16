import { type SwapMechanismPin } from "../pin.js";
import { type SolanaImmutableProgramAuthority, type SolanaUpgradeableProgramAuthority } from "../solana-program-authority.js";
export declare const JUPITER_V1_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export declare const JUPITER_V1_POOL = "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d";
/**
 * Everything from here to the current route set below is historical: the byte-pinned generations 899161 (JUP6),
 * 099da3 (JUP6) and c422b2 (Whirlpool) of APN 0.5.42 and earlier. They identify saved materials and operations so those
 * stay readable and observable; they never quote, approve or sign again.
 */
export interface JupiterV1RegisteredProgramPin {
    readonly programId: string;
    readonly programDataAddress: string;
    readonly payloadHash: string;
    /** New snapshots also bind the complete loader header; historical pins remain exact. */
    readonly programDataHash?: string;
}
export declare const JUPITER_V1_RUNTIME_PROGRAM_PINS: readonly {
    programId: string;
    programDataAddress: string;
    payloadHash: string;
}[];
export declare const JUPITER_V1_WHIRLPOOL_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Static-fee pool reviewed from public mainnet accounts at slot 454440585. */
export declare const JUPITER_V1_WHIRLPOOL_FP_POOL = "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q";
export declare const JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Independently captured on two mainnet origins. Runtime bytes only, not a source-build attestation. */
export declare const JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS: readonly JupiterV1RegisteredProgramPin[];
/** Separate owner admission: historical FP policy cannot authorize upgraded executable bytes. */
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Additional finite route; the historical 83 mechanism and registry above remain unchanged. */
export declare const JUPITER_V1_WHIRLPOOL_V2_POOL = "Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e";
export declare const JUPITER_V1_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Memo and the fixed setup programs cannot be upgraded; their loader is the pin. */
export declare const JUPITER_V1_MEMO_PIN: Readonly<{
    programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    loader: "BPFLoader2111111111111111111111111111111111";
}>;
export declare const JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** A separately admitted pool. Historical mechanism and registry digests above stay exact. */
export declare const JUPITER_V1_WHIRLPOOL_4H_POOL = "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW";
export declare const JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Additive upgraded generations; historical SwapV2 admissions do not authorize these bytes. */
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS: readonly (Readonly<{
    programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
    loader: "BPFLoader2111111111111111111111111111111111";
}> | Readonly<{
    programId: "ComputeBudget111111111111111111111111111111";
    loader: "NativeLoader1111111111111111111111111111111";
}> | Readonly<{
    programId: "11111111111111111111111111111111";
    loader: "NativeLoader1111111111111111111111111111111";
}>)[];
/**
 * Whirlpool upgraded at slot 457152296 (2026-10-15 07:22:05 UTC, Squads vault GwH3Hiv5…, transaction 2Z156jvt…).
 * Two mainnet origins returned identical ProgramData bytes. Runtime bytes only, not a source-build attestation.
 * The JUP6 and Token entries are the registered 099da3 snapshot; only the shared Whirlpool executable pin changes.
 */
export declare const JUPITER_V1_WHIRLPOOL_C422B2_PAYLOAD_HASH = "c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f";
export declare const JUPITER_V1_WHIRLPOOL_C422B2_PROGRAM_DATA_HASH = "a49ebc534880f4aaf525b5fd1504aed6223928bdbbea6c83d40473eb17abd04e";
export declare const JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS: readonly JupiterV1RegisteredProgramPin[];
/** Separate owner admissions: 099da3-generation policies name the previous Whirlpool bytes and cannot authorize these. */
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_MECHANISM_PIN: Readonly<SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/**
 * Current route set (owner decision, phase 2): one mechanism per pool that names no executable bytes, so a routine
 * JUP6 or Whirlpool upgrade changes nothing. What is pinned instead is each upgradeable program's ProgramData address and
 * upgrade authority, read from 45-byte loader headers (2026-10-16, slot 457686204): JUP6 CvQZZ23q… (deployed at slot
 * 454465850), Whirlpool's Squads v4 vault GwH3Hiv5… (deployed at slot 457152296), and SPL Token, whose authority was
 * removed. A different authority refuses; a new deployment slot alone is accepted.
 */
export declare const JUPITER_V1_PROGRAM_AUTHORITIES: readonly SolanaUpgradeableProgramAuthority[];
/** Programs that can never be upgraded: BPFLoader2 or native. Their loader is the pin. */
export declare const JUPITER_V1_IMMUTABLE_PROGRAMS: readonly SolanaImmutableProgramAuthority[];
export declare const JUPITER_V1_83_MECHANISM_PIN: SwapMechanismPin;
export declare const JUPITER_V1_FP_MECHANISM_PIN: SwapMechanismPin;
export declare const JUPITER_V1_ESV_MECHANISM_PIN: SwapMechanismPin;
export declare const JUPITER_V1_4H_MECHANISM_PIN: SwapMechanismPin;
export declare const JUPITER_V1_83_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_FP_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_ESV_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_4H_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
