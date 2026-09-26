import { type RawSolanaAccount } from "./accounts.js";
export declare const ORCA_STABLE_PREVIEW_SCHEMA: "apn.orca-stable-unsigned-preview.v1";
/** Caller supplied account data and quote must come from a separately verified, same-slot market snapshot. This API never reads RPC. */
export interface OrcaStablePrepareInput {
    readonly owner: string;
    readonly quote: {
        readonly chain: string;
        readonly pool: string;
        readonly program: string;
        readonly sourceMint: string;
        readonly destinationMint: string;
        readonly vaultA: string;
        readonly vaultB: string;
        readonly direction: string;
        readonly slot: string;
        readonly amountInAtomic: string;
        readonly expectedOutputAtomic: string;
        readonly minimumOutputAtomic: string;
        readonly tickCurrentIndex: number;
        readonly tickArrayStarts: readonly number[];
        readonly signed: boolean;
        readonly broadcast: boolean;
    };
    readonly snapshot: {
        readonly slot: string;
        readonly owner: RawSolanaAccount;
        readonly usdcAta: RawSolanaAccount | null;
        readonly usdtAta: RawSolanaAccount | null;
        readonly usdcAtaAddress: string;
        readonly usdtAtaAddress: string;
        readonly programPinsVerified: boolean;
        readonly poolAndTickArraysVerified: boolean;
        readonly oracleAbsent: boolean;
    };
    readonly lifetime: {
        readonly blockhash: string;
        readonly currentBlockHeight: string;
        readonly lastValidBlockHeight: string;
    };
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
    readonly createUsdtAta: boolean;
    readonly usdtAtaRentLamports?: string;
    readonly maximumAtaRentLamports?: string;
}
export interface OrcaStableUnsignedPreview {
    readonly schemaVersion: typeof ORCA_STABLE_PREVIEW_SCHEMA;
    readonly signable: false;
    readonly executable: false;
    readonly owner: string;
    readonly sourceAta: string;
    readonly destinationAta: string;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly marketSlot: string;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
    readonly messageBase64: string;
    readonly messageHash: string;
    readonly unsignedPayload: string;
    readonly createUsdtAta: boolean;
    readonly instructionPrograms: readonly string[];
    readonly tickArrayStarts: readonly number[];
    readonly tickCurrentIndex: number;
    readonly oracle: string;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
}
/** Offline, unsigned preview only. It deliberately exposes no signer or send path. */
export declare function prepareOrcaStableUnsigned(input: OrcaStablePrepareInput): Promise<OrcaStableUnsignedPreview>;
/** Reparse material and enforce the finite message shape before any future consumer can use it. */
export declare function validateOrcaStableUnsigned(value: OrcaStableUnsignedPreview): Promise<OrcaStableUnsignedPreview>;
