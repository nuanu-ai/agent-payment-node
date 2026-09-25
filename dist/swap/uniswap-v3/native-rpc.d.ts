import type { EvmRpcCall } from "../../evm-ports.js";
export interface NativeBatchCall extends EvmRpcCall {
    readonly beginQuote?: () => void;
    readonly batch?: (items: readonly {
        readonly method: string;
        readonly params: readonly unknown[];
    }[]) => Promise<readonly unknown[]>;
}
/** Execution checks use the same RPC endpoint without quote-only batch capability. */
export declare function scalarUniswapRpcCall(call: EvmRpcCall): EvmRpcCall;
/** A batch-selected quote never retries its reads as scalar requests. */
export declare function nativeReads(call: NativeBatchCall, items: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]): Promise<readonly unknown[]>;
