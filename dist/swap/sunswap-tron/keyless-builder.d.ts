import type { CommandRequest } from "../../commands.js";
import { type TronRpcPort } from "../../tron/rpc.js";
import type { SwapQuoteSnapshot } from "../quote.js";
import { type SunSwapPreparedMaterial, type SunSwapPreparedMaterialPort } from "./prepared.js";
/** Mirrors the generic guarded-swap read-only builder contract; the sibling runtime owns the canonical declaration. */
export interface SunSwapGuardedPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: string;
    readonly gasOrEnergy: Readonly<Record<string, string>>;
    readonly execution: unknown;
}
export interface SunSwapGuardedReadOnlyBuilder<Request> {
    quote(input: Request & {
        readonly now: Date;
    }): Promise<unknown>;
    load(quoteHash: string): Promise<SunSwapGuardedPreparedMaterial | null>;
}
/** The CLI quote plus the owner-supplied TRON fee_limit (SUN) and router deadline (unix seconds); neither is defaulted. */
export type SunSwapKeylessQuoteRequest = Extract<CommandRequest, {
    readonly command: "swap.sunswap.quote";
}> & {
    readonly feeLimitSun: string;
    readonly deadline: number;
};
/**
 * Keyless SunSwap V2 builder: price, output and reserves come from the pinned router and pair via constant calls, the
 * unsigned TriggerSmartContract is encoded locally from the pinned ABI, and the exact call is simulated from the owner.
 * It never signs, broadcasts, or calls an off-chain quote API.
 */
export declare class SunSwapKeylessQuoteBuilder implements SunSwapGuardedReadOnlyBuilder<SunSwapKeylessQuoteRequest> {
    private readonly rpc;
    private readonly store;
    constructor(rpc: TronRpcPort, store: SunSwapPreparedMaterialPort);
    inventory(): {
        catalog: Readonly<{
            schemaVersion: "apn.sunswap-tron-v2-pins.v1";
            chainId: 728126428;
            chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
            router: Readonly<{
                address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
                contractName: "UniswapV2Router02";
                codeHash: "cb5fd0396849833189158afd71529ee326e7d65e8f852d1b510b520bc16a3fb5";
                factory: "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
                wrappedNative: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
            }>;
            factory: Readonly<{
                address: "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
                contractName: "UniswapV2Factory";
                codeHash: "4d942d934b574c09244bf6876f248e0cbac1fa3d18128e8efcb82aa6b234b1fe";
            }>;
            pair: Readonly<{
                address: "TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ";
                token0: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
                token1: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
                codeHash: "41625dc36ebfc3d0d2d89132975e84ad64738f2b4ee892f4561cbf33796d14d8";
                lpFeeNumerator: 997;
                lpFeeDenominator: 1000;
            }>;
            wrappedNative: Readonly<{
                address: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
                contractName: "WTRX";
                symbol: "WTRX";
                decimals: 6;
                codeHash: "12573415957a15017dd28752d528e7de25262abd102afd3f5d0529909c3dc03e";
            }>;
            usdt: Readonly<{
                address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
                contractName: "TetherToken";
                symbol: "USDT";
                decimals: 6;
                codeHash: "99bb60e56b4cd2642c6847e372b18b6e0f9514229e3086d3a042d60a4c7b78a9";
            }>;
            path: readonly ("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" | "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR")[];
            swapFunction: "swapExactETHForTokens(uint256,address[],address,uint256)";
            swapSelector: "7ff36ab5";
            quoteFunction: "getAmountsOut(uint256,address[])";
            reservesFunction: "getReserves()";
            maxHeadDriftBlocks: 10;
            pinEvidence: Readonly<{
                verifiedAt: "2026-09-18T04:16:23.000Z";
                verifiedAtBlock: "86344275";
                methods: readonly string[];
                checks: readonly string[];
            }>;
            quoteSource: "onchain_router_getAmountsOut_and_pair_getReserves.v1";
            encodingPolicy: "local-abi-v2-swapExactETHForTokens-owner-recipient.v1";
        }>;
        admitted: boolean;
    };
    quote(input: SunSwapKeylessQuoteRequest & {
        readonly now: Date;
    }): Promise<SunSwapPreparedMaterial>;
    load(quoteHash: string): Promise<SunSwapPreparedMaterial | null>;
}
export interface SunSwapChainParameters {
    readonly energyPriceSun: bigint;
    readonly maximumFeeLimitSun: bigint;
    readonly bandwidthPriceSun: bigint;
}
export declare function sunSwapChainParameters(rpc: TronRpcPort): Promise<SunSwapChainParameters>;
/** Economic guard: the owner must hold the call value, the full fee_limit and the full bandwidth burn before any signing exists. */
export declare function assertSunSwapOwnerFunding(rpc: TronRpcPort, owner: string, requiredSun: bigint): Promise<bigint>;
