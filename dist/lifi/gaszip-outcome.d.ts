import type { Hex } from "viem";
import type { AssetUsageState } from "../asset-usage-ledger.js";
/**
 * Terminal outcomes shared by the GasZip lanes. Every non-happy path ends in one of them instead of holding the wallet's
 * Base conflict domain open: never sent, reverted at the safe head, or delivered/failed at the destination.
 */
export type GaszipTerminalState = "completed" | "failed_before_effect" | "failed_confirmed_revert" | "destination_failed";
export declare const GASZIP_TERMINAL_STATES: readonly string[];
/** A source effect that landed stays counted (finalized) even when the destination failed; an unsent one is released. */
export declare function gaszipUsageState(state: GaszipTerminalState): Exclude<AssetUsageState, "reserved">;
/**
 * A well-formed JSON-RPC error answer to eth_sendRawTransaction is a definite refusal of those bytes, except the answers that
 * say the node already holds them. Transport failures and malformed answers stay ambiguous.
 */
export declare function gaszipSendRefused(value: Record<string, unknown>, id: string): boolean;
interface NonceReader {
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
/**
 * The one extra read on the absent-transaction path: when the owner's nonce at the safe head is already past the signed
 * nonce, a different transaction used it, so these signed bytes can never land.
 */
export declare function gaszipNonceConsumed(rpc: NonceReader, owner: string, nonce: string, quantity: (value: unknown) => bigint): Promise<boolean>;
/** The terminal digest of a signed effect that APN retired without it landing; the scrubbed bytes are never sent again. */
export declare function gaszipUnlandedReason(reason: "signed_never_sent" | "send_rejected" | "authority_refused_before_transport" | "nonce_consumed_unlanded", transactionHash: Hex | null): {
    reason: "signed_never_sent" | "send_rejected" | "authority_refused_before_transport" | "nonce_consumed_unlanded";
    transactionHash: `0x${string}` | null;
};
export {};
