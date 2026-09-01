export interface ProviderX402TransactionReservation {
    readonly schemaVersion: "apn.provider-x402.transaction-reservation.v1";
    readonly chainId: "8453";
    readonly transactionHash: `0x${string}`;
    readonly operationId: string;
    readonly profileHash: string;
    readonly evidenceMode: "exact_transaction";
    readonly idempotencyDigest: string;
    readonly materialDigest: string;
    readonly createdAt: string;
    readonly integrityHash: string;
}
export interface ProviderX402TransactionReservationIndex {
    readonly schemaVersion: "apn.provider-x402.transaction-reservation-index.v1";
    readonly reservations: readonly ProviderX402TransactionReservation[];
    readonly integrityHash: string;
}
export declare function recoveryMaterialDigest(input: {
    readonly operationId: string;
    readonly transactionHash: `0x${string}`;
    readonly idempotencyDigest: string;
}): string;
export declare function sealTransactionReservation(value: Omit<ProviderX402TransactionReservation, "integrityHash">): ProviderX402TransactionReservation;
export declare function validateTransactionReservation(value: unknown): ProviderX402TransactionReservation;
export declare function sameReservation(left: ProviderX402TransactionReservation, right: ProviderX402TransactionReservation): boolean;
export declare function sealTransactionReservationIndex(reservations: readonly ProviderX402TransactionReservation[]): ProviderX402TransactionReservationIndex;
export declare function validateTransactionReservationIndex(value: unknown): ProviderX402TransactionReservationIndex;
