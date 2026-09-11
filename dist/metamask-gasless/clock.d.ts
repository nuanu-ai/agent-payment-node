import type { ClockPort } from "../ports.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
/** Invocation-local monotonicity plus persisted-time checks; never an onchain expiry. */
export declare class MetaMaskGaslessClock {
    private readonly clock;
    private previous;
    private lastValid;
    constructor(clock: ClockPort);
    check(op?: MetaMaskGaslessOperationRecord, observations?: readonly string[]): number;
    fresh(observedAt: string, op?: MetaMaskGaslessOperationRecord): number;
    beforeDispatch(op: MetaMaskGaslessOperationRecord, observedAt: string): number;
    beforeApproval(op: MetaMaskGaslessOperationRecord): number;
    /** Forensic ordering for a pre-effect failure, never a new authorization sample. */
    failureAt(op: MetaMaskGaslessOperationRecord): string;
}
