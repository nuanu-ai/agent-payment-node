import type { ClockPort } from "../ports.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import { type RelayBnbProofPorts } from "./destination-proof.js";
import type { RelaySourceFinalityPorts, RelayObserveResult } from "./observe.js";
import { RelayKeylessStatusService } from "./status.js";
/** Source inclusion is required to match the signed, saved native deposit envelope. */
export declare function verifyRelayNativeSourceObservation(op: RelayUnsignedOperation, hash: string, observation: RelayDepositObservation): "confirmed" | "failed";
export declare class RelayNativeObserveService {
    private readonly state;
    private readonly source;
    private readonly destinationInvocation;
    private readonly status;
    private readonly clock;
    private readonly usedInvocations;
    constructor(state: StateStore, source: RelaySourceFinalityPorts, destinationInvocation: (chainId: 137 | 143) => RelayBnbProofPorts, status?: RelayKeylessStatusService, clock?: ClockPort);
    private result;
    observe(op: RelayUnsignedOperation): Promise<RelayObserveResult>;
}
