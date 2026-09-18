import type { ClockPort } from "../../ports.js";
import { type TronRpcPort } from "../../tron/rpc.js";
import { type SwapOperationRecord } from "../model.js";
import type { SunSwapExecutionFreshness } from "./execution-binding.js";
import { type SunSwapPreparedMaterial } from "./prepared.js";
/**
 * Pre-signing guard at the current head: mainnet genesis, unchanged energy and bandwidth prices, every pinned code
 * hash, a live reference block and expiration, the exact unsigned call still returning at least the minimum within
 * the fee_limit, and a balance that covers the maximum TRX debit. Any refusal happens before the submission marker.
 */
export declare class SunSwapExecutionGuard {
    private readonly rpc;
    private readonly clock;
    constructor(rpc: TronRpcPort, clock: ClockPort);
    inspect(operationValue: SwapOperationRecord, materialValue: SunSwapPreparedMaterial): Promise<SunSwapExecutionFreshness>;
}
