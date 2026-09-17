export declare const JUPITER_SOLANA_SCHEMA: "apn.swap.jupiter-solana.v1";
export declare const SOLANA_MAINNET_GENESIS: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export declare const JUPITER_SWAP_API_V2: "https://api.jup.ag/swap/v2";
export declare const JUPITER_V6_PROGRAM: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export declare const WRAPPED_SOL_MINT: "So11111111111111111111111111111111111111112";
export declare const SOLANA_USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export declare const SYSTEM_PROGRAM: "11111111111111111111111111111111";
export declare const COMPUTE_BUDGET_PROGRAM: "ComputeBudget111111111111111111111111111111";
export declare const TOKEN_PROGRAM: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const ASSOCIATED_TOKEN_PROGRAM: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export declare const ADDRESS_LOOKUP_TABLE_PROGRAM: "AddressLookupTab1e1111111111111111111111111";
export declare const JUPITER_V2_SOURCE: Readonly<{
    apiBase: "https://api.jup.ag/swap/v2";
    programLabelsSource: "https://api.jup.ag/swap/v2/program-id-to-label";
    schemaDigest: string;
}>;
export interface JupiterRouteProgram {
    readonly programId: string;
    readonly label: string;
}
export interface JupiterProgramSnapshot {
    readonly schemaVersion: typeof JUPITER_SOLANA_SCHEMA;
    readonly sourceUrl: "https://api.jup.ag/swap/v2/program-id-to-label";
    readonly entries: readonly JupiterRouteProgram[];
    readonly digest: string;
}
/** Default-deny. A caller must inject a reviewed frozen snapshot; no network fallback exists. */
export declare const EMPTY_PROGRAM_SNAPSHOT: JupiterProgramSnapshot;
export declare function createProgramSnapshot(entries: readonly JupiterRouteProgram[]): JupiterProgramSnapshot;
export declare function validateProgramSnapshot(value: unknown): JupiterProgramSnapshot;
export declare function canonicalAddress(value: string): string;
export declare function canonicalBase64(value: unknown, maximumBytes?: number): Uint8Array;
export declare function atomic(value: unknown, allowZero?: boolean): bigint;
export declare function hash64(value: unknown): string;
export declare function sha256Bytes(value: Uint8Array): string;
export declare function invalid(message: string): never;
export declare function corrupt(message: string): never;
