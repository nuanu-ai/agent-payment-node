import type { ClockPort } from "../ports.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessSnapshot } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessApprovalPort, SmartAccountGaslessRpcPort } from "./ports.js";
/** Fresh finite wall time, monotonic within this invocation and no earlier than any saved observation. */
export declare class SmartAccountGaslessClock {
    private readonly clock;
    private previous;
    constructor(clock: ClockPort);
    check(op?: SmartAccountGaslessOperationRecord, observations?: readonly string[]): number;
    live(op: SmartAccountGaslessOperationRecord, minimumRemaining?: number): number;
    fresh(observedAt: string, op?: SmartAccountGaslessOperationRecord): number;
    signing(op: SmartAccountGaslessOperationRecord): number;
    /** Forensic timestamp for refusal, never a new sample granting an effect. */
    failureAt(op: SmartAccountGaslessOperationRecord): string;
}
export declare function smartAccountGaslessSnapshot(value: unknown, binding: SmartAccountGaslessBinding, rpc: SmartAccountGaslessRpcPort, op?: SmartAccountGaslessOperationRecord): SmartAccountGaslessSnapshot;
export declare function smartAccountGaslessApprovalPhrase(op: SmartAccountGaslessOperationRecord): string;
export declare function smartAccountGaslessApprovalSummary(op: SmartAccountGaslessOperationRecord, now: number): Readonly<Record<string, unknown>>;
export declare class TtySmartAccountGaslessApproval implements SmartAccountGaslessApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<SmartAccountGaslessApprovalPort["confirm"]>[0]): Promise<boolean>;
}
