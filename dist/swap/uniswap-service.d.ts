import type { AssetPolicyRegistry } from "../asset-policy-registry.js";
import { GuardedSwapService } from "./service.js";
import type { SwapOperationRecord } from "./model.js";
import type { SwapProtocolRegistry } from "./protocol-registry.js";
import type { SwapQuoteInput } from "./quote.js";
import { type UniswapSwapResponse } from "./uniswap-codec.js";
import { UniswapTradingApi } from "./uniswap-http.js";
import { UniswapEvmSimulator } from "./uniswap-simulation.js";
export interface UniswapQuoteInput {
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
    readonly deadline: number;
    readonly maxGasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly now: Date;
}
export interface UniswapGuardedQuote {
    readonly quote: SwapQuoteInput;
    readonly envelope: UniswapSwapResponse["swap"];
    readonly deadline: number;
    readonly providerQuote: unknown;
    readonly providerRequestHash: string;
}
export declare class UniswapGuardedSwapBuilder {
    private readonly api;
    private readonly simulator;
    constructor(api: Pick<UniswapTradingApi, "quote" | "swap">, simulator: Pick<UniswapEvmSimulator, "simulate">);
    inventory(): {
        catalog: import("./uniswap-pin.js").UniswapOfficialPinCatalog;
        admitted: boolean;
        note: string;
    };
    quote(input: UniswapQuoteInput): Promise<UniswapGuardedQuote>;
    prepare(input: UniswapQuoteInput & {
        readonly assetPolicy: AssetPolicyRegistry;
        readonly protocolRegistry: SwapProtocolRegistry;
        readonly idempotencyKey: string;
    }, core: GuardedSwapService): Promise<{
        readonly operation: SwapOperationRecord;
        readonly quote: UniswapGuardedQuote;
    }>;
    refuseTokenApproval(): never;
    refuseExecution(): never;
}
