import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { UniswapTokenOperation } from "./token-operation.js";
/** Fresh post-approval guard: exact allowance, code pins, quote floor, and exact swap simulation. */
export declare class UniswapTokenRevalidator {
    private readonly call;
    private readonly verifyPins;
    constructor(call: EvmRpcCall, verifyPins?: (call: EvmRpcCall, tag: Hex) => Promise<void>);
    revalidate(op: UniswapTokenOperation): Promise<void>;
}
