import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpcPort } from "../../solana/rpc.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort, type GuardedSwapPolicyResolver } from "../runtime.js";
import { type OrcaKeylessQuoteRequest } from "./builder.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
export interface OrcaKeylessRuntimeOptions {
    readonly state: StateStore;
    readonly clock: ClockPort;
    readonly policy: GuardedSwapPolicyResolver;
    readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
    readonly tty?: TtyTransferApprovalOptions;
    /** Solana mainnet reader and sender. Production passes the APN_SOLANA_RPC_URL rail client. */
    readonly rpc: SolanaRpcPort;
    /** Encrypted local Solana wallet: seed for signing, sealed signed bytes before the single send. */
    readonly accounts: Pick<ChainWalletStoragePort, "account" | "withSeed" | "effect" | "saveEffect">;
    /** Program byte verifier. Production passes verifyOrcaProgramPins. */
    readonly verifyPins: OrcaProgramPinVerifier;
}
export declare function createOrcaKeylessRuntime(options: OrcaKeylessRuntimeOptions): GuardedSwapRuntime<OrcaKeylessQuoteRequest>;
