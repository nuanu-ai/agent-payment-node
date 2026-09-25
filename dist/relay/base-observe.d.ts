import type { StateStore } from "../state.js";
import { type RelayBnbProofPorts } from "./destination-proof.js";
import { RelayKeylessStatusService } from "./status.js";
export declare class RelayBaseObserveService {
    private readonly state;
    private readonly destinationInvocation;
    private readonly status;
    private readonly usedInvocations;
    constructor(state: StateStore, destinationInvocation: () => RelayBnbProofPorts, status?: RelayKeylessStatusService);
    observe(operationId: string): Promise<{
        operationId: string;
        state: "prepared_waiting" | "provider_candidate_unproven" | "recipient_credit_observed";
        reason: string;
        providerStatus: string | null;
        destinationProof: import("./destination-proof.js").RelayBnbProofResult | null;
        sourceFinalized: boolean;
        causalLinkCryptographicallyProven: false;
        paidAcceptance: false;
        operationalAcceptance: false;
    }>;
}
