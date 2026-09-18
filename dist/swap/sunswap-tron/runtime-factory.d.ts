import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort, type GuardedSwapPolicyResolver } from "../runtime.js";
import { type SunSwapKeylessQuoteRequest } from "./keyless-builder.js";
export interface SunSwapKeylessRuntimeOptions {
    readonly state: StateStore;
    readonly clock: ClockPort;
    readonly policy: GuardedSwapPolicyResolver;
    readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
    readonly tty?: TtyTransferApprovalOptions;
    /** TRON mainnet reader and broadcaster. Production passes new TronRpc(APN_TRON_RPC_URL); it fails closed when unset. */
    readonly rpc: TronRpcPort;
    /** The profile's encrypted local chain wallet (ChainAccountStore). */
    readonly accounts: ChainWalletStoragePort;
}
export declare function createSunSwapKeylessRuntime(options: SunSwapKeylessRuntimeOptions): GuardedSwapRuntime<SunSwapKeylessQuoteRequest>;
