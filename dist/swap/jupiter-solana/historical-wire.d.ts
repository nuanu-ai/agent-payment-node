/** Pure refusal predicate, not an issuer or signature/expiry authority. */
export declare function assertHistoricalOrdinaryRecentBlockhash(raw: string, instructions: readonly {
    readonly programId: string;
    readonly data: string;
}[]): void;
