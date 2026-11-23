import type { EvmRpcCall } from "../../evm-ports.js";
import type { BridgeHttps } from "../../lifi/https.js";
import { GuardedSwapRuntime } from "../runtime.js";
import { UniswapNativeReceiptObserver } from "../uniswap-ethereum/execution/observer.js";
import type { UniswapBalanceEvidencePort } from "../uniswap-ethereum/execution/evidence-store.js";
import { UniswapNativeQuoteBuilder, type UniswapKeylessQuoteRequest } from "../uniswap-v3/builder.js";
import { SavedUniswapQuoteStore } from "../uniswap-v3/material.js";
import type { UniswapV3PinVerifier } from "../uniswap-v3/pins.js";
import type { UniswapKeylessRuntimeOptions } from "../uniswap-v3/runtime-factory.js";
/** The BNB Smart Chain quote builder: native BNB through SwapRouter02 into Binance-Peg USDT or USDC. */
export declare class BnbUniswapQuoteBuilder extends UniswapNativeQuoteBuilder {
    constructor(call: EvmRpcCall, quotes: SavedUniswapQuoteStore, verifyPins: UniswapV3PinVerifier);
}
/** The BNB Smart Chain observer, over APN_BNB_RPC_URL (and APN_BNB_ARCHIVE_RPC_URL for block-pinned reads, when set). */
export declare class UniswapBnbReceiptObserver extends UniswapNativeReceiptObserver {
    constructor(call: EvmRpcCall, now: () => Date, evidence?: UniswapBalanceEvidencePort);
}
/** Resolves APN_BNB_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export declare function lazyBnbRpcCall(environment: Readonly<Record<string, string | undefined>>, transport?: Pick<BridgeHttps, "request">): EvmRpcCall;
/**
 * The guarded swap runtime of the BNB lane: the same owner admission, foreground consent, single send and observe-only
 * status as the Ethereum keyless lane, with BNB's builder, observer, protocol registry and code-pin verifiers.
 */
export declare function createUniswapBnbRuntime(options: UniswapKeylessRuntimeOptions): GuardedSwapRuntime<UniswapKeylessQuoteRequest>;
