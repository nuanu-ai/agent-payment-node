import { type GaszipProviderFailure } from "./gaszip-native-delivery.js";
import { type Hex } from "viem";
/**
 * GasZip direct deposit (deposit to sender): Base native ETH to the payer's own native balance on the destination chain.
 * One route, keyed by destination chain; the table holds protocol data only. It never grants LI.FI GasZip execution.
 */
export interface GaszipDirectRoute {
    /** Error prefix, effect-binding lane and CLI group (`apn <lane> funding ...`). */
    readonly lane: "mega" | "sei";
    readonly kind: "mega_gaszip" | "sei_gaszip";
    readonly schemaVersion: "apn.mega-gaszip-operation.v1" | "apn.sei-gaszip-operation.v1";
    readonly sourceChain: 8453;
    readonly destinationChain: 4326 | 1329;
    readonly destinationName: string;
    readonly destinationAsset: string;
    /** GasZip short chain id; the calldata is `0x01 || short` (deposit to the sender). */
    readonly short: 514 | 246;
    readonly target: string;
    readonly data: Hex;
    readonly mechanism: Readonly<{
        provider: "gaszip";
        reference: string;
    }>;
    readonly destinationRpcVariable: "APN_MEGA_RPC_URL" | "APN_SEI_RPC_URL";
    /** The prepared operation also holds the payer's destination account (as each route has since it shipped). */
    readonly holdsDestinationAccount: boolean;
}
export declare const GASZIP_DIRECT_ROUTES: Readonly<{
    readonly mega: Readonly<{
        lane: "mega";
        kind: "mega_gaszip";
        schemaVersion: "apn.mega-gaszip-operation.v1";
        sourceChain: 8453;
        destinationChain: 4326;
        destinationName: "Mega";
        destinationAsset: "ETH";
        short: 514;
        target: `0x${string}`;
        data: "0x010202";
        mechanism: Readonly<{
            provider: "gaszip";
            reference: "v2-direct-base-mega-self-010202.1";
        }>;
        destinationRpcVariable: "APN_MEGA_RPC_URL";
        holdsDestinationAccount: false;
    }>;
    readonly sei: Readonly<{
        lane: "sei";
        kind: "sei_gaszip";
        schemaVersion: "apn.sei-gaszip-operation.v1";
        sourceChain: 8453;
        destinationChain: 1329;
        destinationName: "Sei";
        destinationAsset: "SEI";
        short: 246;
        target: `0x${string}`;
        data: "0x0100f6";
        mechanism: Readonly<{
            provider: "gaszip";
            reference: "v2-direct-base-sei-self-0100f6.1";
        }>;
        destinationRpcVariable: "APN_SEI_RPC_URL";
        holdsDestinationAccount: true;
    }>;
}>;
/** Strict parsers that refuse with the route's own `<lane>_gaszip_<reason>`. */
export interface GaszipCodec {
    fail(reason: string): never;
    object(v: unknown): Record<string, unknown>;
    uint(v: unknown): bigint;
    quantity(v: unknown): bigint;
    hash(v: unknown): Hex;
    address(v: unknown): string;
    json(text: string): unknown;
    exact(v: Record<string, unknown>, required: readonly string[], optional?: readonly string[]): void;
}
export declare function gaszipCodec(route: Pick<GaszipDirectRoute, "lane">): GaszipCodec;
export interface GaszipFundingQuote {
    readonly digest: string;
    readonly expiresAt: string;
    readonly expectedAtomic: string;
    readonly body: unknown;
}
export declare function inspectGaszipFundingQuote(route: GaszipDirectRoute, value: unknown, now: number): GaszipFundingQuote;
export interface GaszipCorrelatedDelivery {
    readonly hash: Hex;
    readonly amount: string;
    readonly signer: string;
    readonly nonce: string;
    readonly providerDigest: string;
    readonly grossNative?: true;
}
/** Provider mapping authorizes observation only; both effects must be independently proved by their chain RPC. */
export declare function inspectGaszipDelivery(route: GaszipDirectRoute, value: unknown, sourceHash: Hex, owner: string, amount: string, sourceBlock?: string): GaszipCorrelatedDelivery | GaszipProviderFailure | null;
