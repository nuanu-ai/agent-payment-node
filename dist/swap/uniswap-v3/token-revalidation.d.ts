import type { EvmRpcCall } from "../../evm-ports.js";
import type { UniswapTokenOperation } from "./token-operation.js";
/** Fresh post-approval guard: exact allowance, code pins, quote floor, and exact swap simulation. */
export declare class UniswapTokenRevalidator {
    private readonly call;
    constructor(call: EvmRpcCall);
    revalidate(op: UniswapTokenOperation): Promise<void>;
}
