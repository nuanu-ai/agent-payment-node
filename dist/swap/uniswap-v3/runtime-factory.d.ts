import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort, type GuardedSwapPolicyResolver } from "../runtime.js";
import { type UniswapKeylessQuoteRequest } from "./builder.js";
import { type UniswapV3PinVerifier } from "./pins.js";
/** Only the foreground CLI approve command receives a terminal; every other surface refuses consent outright. */
export declare const REFUSING_SWAP_APPROVAL: GuardedSwapForegroundApprovalPort;
export interface UniswapKeylessRuntimeOptions {
    readonly state: StateStore;
    readonly wrapping: WrappingSecretPort;
    readonly clock: ClockPort;
    readonly policy: GuardedSwapPolicyResolver;
    readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
    readonly tty?: TtyTransferApprovalOptions;
    /** Ethereum mainnet reader/sender. Production passes lazyEthereumRpcCall(process.env). */
    readonly call: EvmRpcCall;
    /** Code-pin verifier. Production passes verifyUniswapV3CodePins. */
    readonly verifyPins: UniswapV3PinVerifier;
}
/** Resolves APN_ETHEREUM_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export declare function lazyEthereumRpcCall(environment: Readonly<Record<string, string | undefined>>): EvmRpcCall;
export declare function createUniswapKeylessRuntime(options: UniswapKeylessRuntimeOptions): GuardedSwapRuntime<UniswapKeylessQuoteRequest>;
