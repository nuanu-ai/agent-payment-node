/** Pinned NEAR 1Click lanes. Asset IDs match the public 1Click token list (GET /v0/tokens, 2026-09-18). No wildcard lane exists. */
export declare const ONECLICK_LANE_IDS: readonly ["base-usdc-to-tron-usdt", "ethereum-eth-to-tron-trx", "ethereum-eth-to-solana-sol", "ethereum-eth-to-tron-usdt"];
export type OneClickLaneId = typeof ONECLICK_LANE_IDS[number];
export interface OneClickLaneOrigin {
    readonly network: "base" | "ethereum";
    readonly chainId: 1 | 8453;
    readonly asset: "USDC" | "ETH";
    /** erc20 sends `transfer(deposit, amount)` to the token; native sends exactly `amount` wei to the deposit. */
    readonly kind: "erc20" | "native";
    readonly token: string | null;
    readonly decimals: 6 | 18;
    readonly oneClickAsset: string;
    readonly rpcEnvironment: "APN_BASE_RPC_URL" | "APN_ETHEREUM_RPC_URL";
    readonly maxAmountAtomic: bigint;
}
export interface OneClickLaneDestination {
    readonly network: "tron" | "solana";
    readonly asset: "USDT" | "TRX" | "SOL";
    readonly kind: "trc20" | "native";
    readonly token: string | null;
    readonly decimals: 6 | 9;
    readonly oneClickAsset: string;
    readonly rpcEnvironment: "APN_TRON_RPC_URL" | "APN_SOLANA_RPC_URL";
}
export interface OneClickLane {
    readonly id: OneClickLaneId;
    readonly origin: OneClickLaneOrigin;
    readonly destination: OneClickLaneDestination;
    /**
     * `input_at_par`: origin and destination are the same value unit and decimals, so the loss is input minus the
     * quoted minimum. `quote_rate`: different assets; the only in-band valuation is the quote's own rate, so the loss
     * is quoted output minus the quoted minimum (destination atomic). The owner's minimum output stays the price floor.
     */
    readonly loss: "input_at_par" | "quote_rate";
}
export declare const ONECLICK_LANES: readonly OneClickLane[];
/** Records written before lanes existed (schema v1/v2) were only ever this lane. */
export declare const LEGACY_ONECLICK_LANE: OneClickLaneId;
export declare function oneClickLane(id: unknown): OneClickLane;
/** Exact canonical destination recipient: TRON base58check for TRX/USDT, a 32-byte Solana base58 key for SOL. */
export declare function oneClickRecipient(lane: OneClickLane, value: string): string;
