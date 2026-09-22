import type { EvmRpcCall } from "../../evm-ports.js";
import type { TokenEffectKind, TokenEffectObservation } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
export declare class UniswapTokenObserver {
    private readonly call;
    constructor(call: EvmRpcCall);
    observe(op: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: string): Promise<TokenEffectObservation | null>;
}
