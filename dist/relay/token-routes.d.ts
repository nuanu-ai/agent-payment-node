export type RelayTokenChainId = 1 | 56 | 137 | 8453 | 42161;
export type RelayTokenAlias = "usdc" | "usdt";
export interface RelayToken {
    readonly chainId: RelayTokenChainId;
    /** Relay protocol v2 chain name, as the signed order and payment details spell it. */
    readonly relayChain: "ethereum" | "bnb" | "polygon" | "base" | "arbitrum";
    readonly alias: RelayTokenAlias;
    /** EIP-55 spelling: the identity owner policies, usage holds and consent screens bind. */
    readonly address: string;
    readonly decimals: 6 | 18;
    /** A source here: admissible on the bridge rail (frozen issuer-native row or the reviewed Binance-Peg supplement) and on a
     * chain whose whole network fee is gas x max fee. */
    readonly source: boolean;
}
export interface RelayTokenRoute {
    readonly reference: string;
    readonly source: RelayToken;
    readonly destination: RelayToken;
}
/** The Relay protocol v2 depository named for chains 1, 56, 137, 8453 and 42161 by GET /chains on 2026-11-23. */
export declare const RELAY_TOKEN_DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
/** The block tag each chain's public RPCs answer for a consensus-safe checkpoint (Polygon answers only `finalized`). */
export declare const RELAY_TOKEN_SAFE_TAG: Readonly<Record<RelayTokenChainId, "safe" | "finalized">>;
export declare const RELAY_TOKENS: readonly RelayToken[];
export declare function relayTokenRoutes(): readonly RelayTokenRoute[];
/** The route a new prepare uses, chosen by the caller's chains and token aliases, or null when none is listed. */
export declare function relayTokenRouteFor(sourceChainId: number, sourceAlias: string, destinationChainId: number, destinationAlias: string): RelayTokenRoute | null;
/** The route a saved quote names; an unknown reference is null and its operation is corrupt. */
export declare function relayTokenRouteByReference(reference: unknown): RelayTokenRoute | null;
