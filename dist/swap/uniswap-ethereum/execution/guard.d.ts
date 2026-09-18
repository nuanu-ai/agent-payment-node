import type { EvmRpcCall } from "../../../evm-ports.js";
import type { ClockPort } from "../../../ports.js";
import { type SwapOperationRecord } from "../../model.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import type { UniswapV3PinVerifier } from "../../uniswap-v3/pins.js";
import type { UniswapExecutionFreshness, UniswapExecutionGuardPort } from "./types.js";
/**
 * Pre-signing guard at the current head: pinned code unchanged, no pending transaction from the account (the next
 * nonce is exact), the owner's fee cap covers base fee plus tip, the balance covers value plus the maximum fee, and
 * the exact unsigned call still succeeds by eth_call.
 */
export declare class UniswapExecutionGuard implements UniswapExecutionGuardPort {
    private readonly call;
    private readonly clock;
    private readonly verifyPins;
    constructor(call: EvmRpcCall, clock: ClockPort, verifyPins: UniswapV3PinVerifier);
    inspect(operationValue: SwapOperationRecord, envelope: UniswapTransactionEnvelope): Promise<UniswapExecutionFreshness>;
}
