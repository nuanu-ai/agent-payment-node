import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_GENESIS } from "../chain-policy.js";

/**
 * x402 `exact` on Solana mainnet (SPL). The seller's facilitator is the fee payer; APN signs only as the token owner of
 * the two compute budget instructions, one classic SPL `TransferChecked` to the payee's associated token account and
 * one Memo (the seller's `extra.memo`, else a random nonce), as the x402 SVM spec requires. Token-2022 mints, native SOL
 * offers and create-account instructions are refused.
 */
export const X402_SOLANA_SCHEMA = "apn.x402-solana-operation.v1" as const;
/** The CAIP-2 identity x402 uses for Solana mainnet: the first 32 characters of the genesis hash. */
export const X402_SOLANA_NETWORK = `solana:${SOLANA_GENESIS.slice(0, 32)}` as const;
/** The owner allowlist names Solana mainnet by its whole genesis hash. */
export const X402_SOLANA_ALLOWLIST_CHAIN = `solana:${SOLANA_GENESIS}` as const;
/** The owner's allowlist row must carry exactly this x402 mechanism pin: x402 `exact` through the classic SPL Token program. */
export const X402_SOLANA_MECHANISM = { provider: "x402-exact-svm", reference: TOKEN_PROGRAM_ADDRESS } as const;
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** SPL Memo v2, the program the x402 reference client uses (no accounts, the memo's UTF-8 bytes as data). */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const X402_SOLANA_MAX_MEMO_BYTES = 256;
/** The spec's nonce when the seller declares no memo: 16 random bytes, hex-encoded (as the reference client does). */
export const X402_SOLANA_NONCE_BYTES = 16;
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
/**
 * The x402 reference client's compute budget (`@x402/svm` DEFAULT_COMPUTE_UNIT_LIMIT and
 * DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS). The facilitator pays the fee; each record freezes the values it signed.
 */
export const X402_SOLANA_COMPUTE_UNIT_LIMIT = 20_000;
export const X402_SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS = "1";
/** How long a prepared payment may wait for the owner's foreground decision before it can no longer be signed. */
export const X402_SOLANA_APPROVAL_WINDOW_MS = 240_000;
/** One signature-index page read when proving whether the payment landed, and at most this many newer entries are opened. */
export const X402_SOLANA_SCAN_LIMIT = 64;
export const X402_SOLANA_SCAN_OPEN_LIMIT = 8;
export const X402_SOLANA_FAMILY = "x402_solana" as const;
export const X402_SOLANA_STORE = "x402-solana" as const;
