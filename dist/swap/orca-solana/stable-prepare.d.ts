import { type RawSolanaAccount } from "./accounts.js";
export declare const ORCA_STABLE_PREVIEW_SCHEMA: "apn.orca-stable-unsigned-preview.v1";
/** Caller supplied account data has no chain provenance. This API only checks internal consistency and never reads RPC. */
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
        readonly slippageBps: number;
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
        readonly pool: RawSolanaAccount;
        readonly tickArrays: readonly RawSolanaAccount[];
        readonly vaultA: RawSolanaAccount;
        readonly vaultB: RawSolanaAccount;
        readonly oracle: RawSolanaAccount | null;
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
    readonly maximumTotalFeeLamports: string;
}
export interface OrcaStableUnsignedPreview {
    readonly schemaVersion: typeof ORCA_STABLE_PREVIEW_SCHEMA;
    readonly trust: "untrusted_offline_snapshot";
    readonly signable: false;
    readonly executable: false;
    readonly manifestDigest: string;
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
    readonly maximumPriorityFeeLamports: string;
    readonly ataRentLamports: string;
    readonly totalFeeAndRentLamports: string;
    readonly maximumTotalFeeLamports: string;
}
/** Offline, unsigned preview only. It deliberately exposes no signer or send path. */
export declare function prepareOrcaStableUnsigned(input: OrcaStablePrepareInput): Promise<OrcaStableUnsignedPreview>;
/** Reparse untrusted preview material. Passing this check never authorizes signing or sending. */
export declare function validateOrcaStableUnsigned(value: OrcaStableUnsignedPreview): Promise<OrcaStableUnsignedPreview>;
