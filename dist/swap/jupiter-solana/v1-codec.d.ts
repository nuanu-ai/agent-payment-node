export interface JupiterV1RawAccountMeta {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
}
export interface JupiterV1RawInstruction {
    readonly programId: string;
    readonly accounts: readonly JupiterV1RawAccountMeta[];
    readonly data: string;
}
export interface JupiterV1QuoteResponse extends Readonly<Record<string, unknown>> {
    readonly inputMint: string;
    readonly outputMint: string;
    readonly inAmount: string;
    readonly outAmount: string;
    readonly otherAmountThreshold: string;
    readonly slippageBps: number;
    readonly swapMode: "ExactIn";
    readonly contextSlot: number;
    readonly routePlan: readonly {
        readonly swapInfo: Readonly<Record<string, unknown>> & {
            readonly ammKey: string;
            readonly label: "Whirlpool";
        };
        readonly percent: 100;
    }[];
}
export interface JupiterV1RawBuildResponse extends Readonly<Record<string, unknown>> {
    readonly computeBudgetInstructions: readonly JupiterV1RawInstruction[];
    readonly setupInstructions: readonly JupiterV1RawInstruction[];
    readonly swapInstruction: JupiterV1RawInstruction;
    readonly cleanupInstruction: JupiterV1RawInstruction | null;
    readonly addressLookupTableAddresses: readonly string[];
    readonly blockhashWithMetadata: {
        readonly blockhash: readonly number[];
        readonly lastValidBlockHeight: number;
    };
}
export declare function decodeJupiterV1Quote(value: unknown): JupiterV1QuoteResponse;
export declare function decodeJupiterV1Instruction(value: unknown): JupiterV1RawInstruction;
export declare function decodeJupiterV1Build(value: unknown): JupiterV1RawBuildResponse;
export declare function jupiterV1Lifetime(build: JupiterV1RawBuildResponse): {
    blockhash: string;
    lastValidBlockHeight: string;
};
export declare function jupiterV1Instructions(build: JupiterV1RawBuildResponse): readonly JupiterV1RawInstruction[];
export declare function jupiterV1ResponseHash(value: unknown): string;
export declare function freezeJson<T>(value: T): T;
