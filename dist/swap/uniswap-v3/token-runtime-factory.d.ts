import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import type { UniswapTokenCommandRuntime } from "./token-execution.js";
export declare function createUniswapTokenRuntime(input: {
    readonly state: StateStore;
    readonly wrapping: WrappingSecretPort;
    readonly clock: ClockPort;
    readonly call: EvmRpcCall;
    readonly foreground: "approve" | "cleanup" | "refuse";
    readonly tty?: TtyTransferApprovalOptions;
    readonly verifyPins?: (call: EvmRpcCall, tag: import("viem").Hex) => Promise<void>;
}): UniswapTokenCommandRuntime;
