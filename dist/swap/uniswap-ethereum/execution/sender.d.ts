import type { Hex } from "viem";
import type { EvmRpcCall } from "../../../evm-ports.js";
import { type SwapOperationRecord } from "../../model.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapSingleSendPort } from "./types.js";
export declare class UniswapSingleSendAdapter implements UniswapSingleSendPort {
    private readonly effects;
    private readonly call;
    constructor(effects: UniswapEffectStorePort, call: EvmRpcCall);
    sendOnce(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, now: Date): Promise<{
        readonly kind: "submitted";
        readonly transactionHash: Hex;
    } | {
        readonly kind: "possible_send";
        readonly transactionHash: Hex;
    }>;
}
