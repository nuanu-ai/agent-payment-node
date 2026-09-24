import { type GaslessTransport } from "../gasless/https.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { type UsdtBoundOperation } from "./bound-operation.js";
import { type UsdtExecutionRecord } from "./execution-journal.js";
import type { UsdtPreparePort } from "./policy-prepare.js";
import { type UsdtRecoveryPort } from "./recovery.js";
import { type UsdtSendSigner, type UsdtSendTransport } from "./send.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
export interface UsdtForegroundApproval {
    approve(bound: UsdtBoundOperation): Promise<void>;
}
export declare class TtyUsdtApproval implements UsdtForegroundApproval {
    approve(bound: UsdtBoundOperation): Promise<void>;
}
export interface UsdtCommandExecuteOptions {
    readonly approval?: UsdtForegroundApproval;
    readonly preparePort?: UsdtPreparePort;
    readonly signer?: UsdtSendSigner;
    readonly sendTransport?: UsdtSendTransport;
    readonly recoveryPort?: UsdtRecoveryPort;
    readonly transport?: GaslessTransport;
    readonly rpcUrl?: string;
}
/** CLI effect boundary. Recovery only observes the hash already recorded in the execution journal. */
export declare class GaslessUsdtCommandExecute {
    private readonly state;
    private readonly clock;
    private readonly wrapping;
    private readonly options;
    private readonly bound;
    private readonly journal;
    constructor(state: StateStore, clock: ClockPort, wrapping: WrappingSecretPort, options?: UsdtCommandExecuteOptions);
    private load;
    private preparePort;
    execute(profileHash: string, operationId: string): Promise<UsdtExecutionRecord>;
    status(profileHash: string, operationId: string): Promise<{
        readonly operationId: string;
        readonly execution: UsdtExecutionRecord | null;
    }>;
    observe(profileHash: string, operationId: string): Promise<UsdtExecutionRecord>;
}
