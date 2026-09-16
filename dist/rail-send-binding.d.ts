import type { RailPreparedTransfer, RailSendBinding } from "./direct-rail-ports.js";
/**
 * How long the owner may read the approval screen. This is the approval deadline only: the sending
 * window opens afterwards, when the send guard re-acquires the block reference.
 */
export declare const SOLANA_APPROVAL_WINDOW_MS = 240000;
/**
 * A re-acquired Solana block reference must still leave this many blocks when the send guard takes
 * it. At roughly 400 ms per slot that is about the 15 s the bridge rail already demands, and a
 * freshly returned blockhash leaves about 150, so only a stale RPC answer is refused.
 */
export declare const SOLANA_MIN_SEND_BLOCKS = 38n;
/** A transient pre-send check is re-run inside the owner's approved window, never past its end. */
export declare const RAIL_PRESEND_ATTEMPTS = 4;
export declare const RAIL_PRESEND_RETRY_MS = 5000;
/** The last attempt must still leave enough of the approval window to acquire a window and send. */
export declare const RAIL_PRESEND_MIN_REMAINING_MS = 15000;
export declare function validateRailSendBinding(value: unknown, prepared: RailPreparedTransfer): RailSendBinding;
/**
 * The lifetime the signed bytes actually carry: the re-acquired one once the send guard has run,
 * and otherwise the preparation-time one, which is all a rail without a send guard ever had.
 */
export declare function railSendLifetime(prepared: RailPreparedTransfer, send: RailSendBinding | null | undefined): {
    readonly blockReference: string;
    readonly lastValidBlockHeight: string | null;
};
/** Pre-send failures carry their own reason token so a transport loss never reads as a refusal. */
export declare function railSendReason(error: unknown, fallback: string): string;
/** Only a transport loss is re-run; a chain refusal and malformed evidence are answers, not noise. */
export declare function railSendTransient(error: unknown): boolean;
