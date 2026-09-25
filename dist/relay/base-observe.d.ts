import { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type RelayBnbProofPorts } from "./destination-proof.js";
import type { RelaySourceFinalityPorts } from "./observe.js";
import { RelayKeylessStatusService } from "./status.js";
export declare class RelayBaseObserveService {
    private readonly state;
    private readonly destinationInvocation;
    private readonly status;
    private readonly source?;
    private readonly usage;
    private readonly usedInvocations;
    constructor(state: StateStore, destinationInvocation: () => RelayBnbProofPorts, status?: RelayKeylessStatusService, source?: RelaySourceFinalityPorts | undefined, usage?: Pick<AssetUsageLedger, "load" | "transition">);
    private reconcileFinalizedSource;
    observe(operationId: string): Promise<{
        operationId: string;
        state: "prepared_waiting" | "provider_candidate_unproven" | "recipient_credit_observed" | "operational_acceptance";
        reason: string;
        providerStatus: string | null;
        destinationProof: import("./destination-proof.js").RelayBnbProofResult | null;
        sourceFinalized: boolean;
        providerStatusBound: boolean;
        sourceUsageFinalized: boolean;
        sourceDepositHash: string | null;
        causalLinkCryptographicallyProven: false;
        paidAcceptance: false;
        operationalAcceptance: boolean;
    }>;
}
