import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import type { UniswapTokenCommandRuntime } from "./token-execution.js";
import { type UniswapTokenLane } from "./token-lane.js";
export interface UniswapTokenRuntimeInput {
    readonly state: StateStore;
    readonly wrapping: WrappingSecretPort;
    readonly clock: ClockPort;
    readonly call: EvmRpcCall;
    readonly foreground: "approve" | "cleanup" | "refuse";
    readonly tty?: TtyTransferApprovalOptions;
    readonly verifyPins?: (call: EvmRpcCall, tag: import("viem").Hex) => Promise<void>;
}
/** The Ethereum token lane's runtime (canonical USDC and USDT through the original SwapRouter). */
export declare function createUniswapTokenRuntime(input: UniswapTokenRuntimeInput): UniswapTokenCommandRuntime;
/**
 * One lane's token-input runtime over that lane's RPC: its builder, signing guard (the lane's pins unless `verifyPins`
 * replaces them), custody, observer, never-lands proof and screens. Records and quotes of the other lane refuse.
 */
export declare function createUniswapTokenLaneRuntime(lane: UniswapTokenLane, input: UniswapTokenRuntimeInput): UniswapTokenCommandRuntime;
