import type { RelayBnbNativeTrace } from "./destination-proof.js";
export declare const POLYGON_PAYOUT_ROUTER = "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be";
export declare function decodePolygonPayoutTrace(value: unknown, transaction: Record<string, unknown>, hash: string, blockHash: string, before: bigint, after: bigint): RelayBnbNativeTrace;
