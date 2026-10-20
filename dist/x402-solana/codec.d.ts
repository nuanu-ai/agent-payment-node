/** True when a PaymentPayload's `accepted` names Solana mainnet; the generic EVM payload rules then do not apply. */
export declare function isSolanaAccepted(accepted: unknown): boolean;
/**
 * The x402 v2 SVM `exact` PaymentPayload APN sends: no extensions, `accepted` one memo-free Solana offer, and a payload
 * that is exactly one base64 partially signed transaction of at most one packet with two signature slots.
 */
export declare function validateSolanaPaymentPayload(value: Record<string, unknown>): void;
