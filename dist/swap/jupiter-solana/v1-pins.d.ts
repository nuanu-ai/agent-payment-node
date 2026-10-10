export declare const JUPITER_V1_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export declare const JUPITER_V1_POOL = "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d";
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
export declare const JUPITER_V1_WHIRLPOOL_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Static-fee pool reviewed from public mainnet accounts at slot 454440585. */
export declare const JUPITER_V1_WHIRLPOOL_FP_POOL = "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q";
export declare const JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Independently captured on two mainnet origins. Runtime bytes only, not a source-build attestation. */
export declare const JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS: readonly JupiterV1RegisteredProgramPin[];
/** Separate owner admission: historical FP policy cannot authorize upgraded executable bytes. */
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Additional finite route; the historical 83 mechanism and registry above remain unchanged. */
export declare const JUPITER_V1_WHIRLPOOL_V2_POOL = "Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e";
export declare const JUPITER_V1_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export declare const JUPITER_V1_MEMO_PIN: Readonly<{
    programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    loader: "BPFLoader2111111111111111111111111111111111";
    byteLength: 74800;
    payloadHash: "f520eaf096361abbb9639ea4dc3e5388a87b9330e121f476607b87c46ef67954";
}>;
export declare const JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** A separately admitted pool. Historical mechanism and registry digests above stay exact. */
export declare const JUPITER_V1_WHIRLPOOL_4H_POOL = "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW";
export declare const JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
/** Additive upgraded generations; historical SwapV2 admissions do not authorize these bytes. */
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN: Readonly<import("../pin.js").SwapMechanismPin>;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare const JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS: readonly (Readonly<{
    programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
    loader: "BPFLoader2111111111111111111111111111111111";
    payloadHash: "6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d";
}> | Readonly<{
    programId: "ComputeBudget111111111111111111111111111111";
    loader: "NativeLoader1111111111111111111111111111111";
    payloadHash: "005950c007e8e550a16beddf836f0082d26d197f5f645ff7c04a5c8d171cf8a1";
}> | Readonly<{
    programId: "11111111111111111111111111111111";
    loader: "NativeLoader1111111111111111111111111111111";
    payloadHash: "c94b792a6d8b25d3e53ea94d8b80111735ed80d6a7dc8deb937cd342707f5f03";
}>)[];
