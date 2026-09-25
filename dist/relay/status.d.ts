import { StateStore } from "../state.js";
export declare class RelayKeylessStatusService {
    private readonly state;
    private readonly fetcher;
    constructor(state: StateStore, fetcher?: typeof fetch);
    status(operationId: string): Promise<{
        kind: "relay_provider_status";
        operationId: string;
        provider: "relay";
        sourceChainId: 1 | 56;
        destinationChainId: 56 | 8453 | 137 | 143;
        status: string;
        chainIdentityObserved: boolean;
        inTxHashes: readonly string[];
        txHashes: readonly string[];
        failReason: string | null;
        refundFailReason: string | null;
        reason: string;
        proofClass: "provider_assertion";
        independentOnchainProof: false;
        paidAcceptance: false;
        executionAdmitted: false;
        nextActions: readonly [];
    }>;
}
