import { type SwapQuoteSnapshot, type SwapSimulationProof } from "../quote.js";
import { type SunSwapV2Market } from "./market.js";
export interface SunSwapQuoteSnapshotInput {
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
    readonly effectiveAt: string;
    readonly expiresAt: string;
    readonly unsignedTransactionPayloadHash: string;
    readonly market: SunSwapV2Market;
    readonly simulation: SwapSimulationProof;
}
/** The generic quote carries on-chain V2 evidence only: the route hash binds router, pair, path, pins, reserves and block. */
export declare function createSunSwapQuoteSnapshot(input: SunSwapQuoteSnapshotInput): SwapQuoteSnapshot;
/** No provider response exists: this digest names the raw on-chain constant results and the pinned code hashes read. */
export declare function sunSwapOnChainEvidenceHash(market: SunSwapV2Market): string;
