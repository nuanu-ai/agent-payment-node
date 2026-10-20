import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_GENESIS } from "../chain-policy.js";
/**
 * x402 `exact` on Solana mainnet (SPL). The seller's facilitator is the fee payer; APN signs only as the token owner of
 * one classic SPL `TransferChecked` to the payee's associated token account, preceded by the two compute budget
 * instructions and nothing else. Token-2022 mints, memo-bound offers and create-account instructions are refused.
 */
export const X402_SOLANA_SCHEMA = "apn.x402-solana-operation.v1";
/** The CAIP-2 identity x402 uses for Solana mainnet: the first 32 characters of the genesis hash. */
export const X402_SOLANA_NETWORK = `solana:${SOLANA_GENESIS.slice(0, 32)}`;
/** The owner allowlist names Solana mainnet by its whole genesis hash. */
export const X402_SOLANA_ALLOWLIST_CHAIN = `solana:${SOLANA_GENESIS}`;
/** The owner's allowlist row must carry exactly this x402 mechanism pin: x402 `exact` through the classic SPL Token program. */
export const X402_SOLANA_MECHANISM = { provider: "x402-exact-svm", reference: TOKEN_PROGRAM_ADDRESS };
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
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
export const X402_SOLANA_FAMILY = "x402_solana";
export const X402_SOLANA_STORE = "x402-solana";
//# sourceMappingURL=constants.js.map