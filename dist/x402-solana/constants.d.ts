/**
 * x402 `exact` on Solana mainnet (SPL). The seller's facilitator is the fee payer; APN signs only as the token owner of
 * the two compute budget instructions, one classic SPL `TransferChecked` to the payee's associated token account and
 * one Memo (the seller's `extra.memo`, else a random nonce), as the x402 SVM spec requires. Token-2022 mints, native SOL
 * offers and create-account instructions are refused.
 */
export declare const X402_SOLANA_SCHEMA: "apn.x402-solana-operation.v1";
/** The CAIP-2 identity x402 uses for Solana mainnet: the first 32 characters of the genesis hash. */
export declare const X402_SOLANA_NETWORK: `solana:${string}`;
/** The owner allowlist names Solana mainnet by its whole genesis hash. */
export declare const X402_SOLANA_ALLOWLIST_CHAIN: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
/** The owner's allowlist row must carry exactly this x402 mechanism pin: x402 `exact` through the classic SPL Token program. */
export declare const X402_SOLANA_MECHANISM: {
    readonly provider: "x402-exact-svm";
    readonly reference: import("@solana/addresses").Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
};
export declare const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** SPL Memo v2, the program the x402 reference client uses (no accounts, the memo's UTF-8 bytes as data). */
export declare const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export declare const X402_SOLANA_MAX_MEMO_BYTES = 256;
/** The spec's nonce when the seller declares no memo: 16 random bytes, hex-encoded (as the reference client does). */
export declare const X402_SOLANA_NONCE_BYTES = 16;
export declare const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
/**
 * The x402 reference client's compute budget (`@x402/svm` DEFAULT_COMPUTE_UNIT_LIMIT and
 * DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS). The facilitator pays the fee; each record freezes the values it signed.
 */
export declare const X402_SOLANA_COMPUTE_UNIT_LIMIT = 20000;
export declare const X402_SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS = "1";
/** How long a prepared payment may wait for the owner's foreground decision before it can no longer be signed. */
export declare const X402_SOLANA_APPROVAL_WINDOW_MS = 240000;
/** One signature-index page read when proving whether the payment landed, and at most this many newer entries are opened. */
export declare const X402_SOLANA_SCAN_LIMIT = 64;
export declare const X402_SOLANA_SCAN_OPEN_LIMIT = 8;
export declare const X402_SOLANA_FAMILY: "x402_solana";
export declare const X402_SOLANA_STORE: "x402-solana";
