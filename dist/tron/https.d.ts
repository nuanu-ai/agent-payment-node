import { request } from "node:https";
import { resolvePublicAddresses } from "../network-policy.js";
/** Production transport pins one validated public address and built-in TLS roots. */
export declare const tronHttpsFetch: typeof fetch;
/** Ten ten-second TRX prepare requests, nine gaps and the ten-second expiry reserve fit the 120-second TRON window. */
export declare const TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS = 1000;
/** Keyless public TRON APIs answer bursts with HTTP 429; two POST starts per second stay under them. "0" turns pacing off. */
export declare const TRON_RPC_DEFAULT_MINIMUM_POST_INTERVAL_MS = 500;
export interface TronHttpsPacingOptions {
    /** Optional canonical decimal milliseconds. Unset uses the default interval above; "0" disables pacing. */
    readonly minimumPostStartIntervalMs?: string | undefined;
    /** Monotonic clock and cancellable delay are injectable for offline transport tests. */
    readonly now?: () => number;
    readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
/** One pacing queue belongs to one APN TRON client, never a process-wide provider limit. */
export declare function configuredTronHttpsFetch(options: TronHttpsPacingOptions): typeof fetch;
/** Dependency injection keeps transport failure tests offline and deterministic. */
export declare function createTronHttpsFetch(requestHttps: typeof request, resolveAddresses: typeof resolvePublicAddresses, pacing?: TronHttpsPacingOptions): typeof fetch;
