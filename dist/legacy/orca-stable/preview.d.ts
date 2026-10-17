export declare const ORCA_STABLE_PREVIEW_SCHEMA: "apn.orca-stable-unsigned-preview.v1";
/** Frozen reader: the unsigned stable preview a released version stored in material and execution bindings. */
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
/** Reparse untrusted preview material. Passing this check never authorizes signing or sending. */
export declare function validateOrcaStableUnsigned(value: OrcaStableUnsignedPreview): Promise<OrcaStableUnsignedPreview>;
