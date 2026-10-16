import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
export declare class RelayKeylessStatusService {
    private readonly state;
    private readonly fetcher;
    constructor(state: StateStore, fetcher?: typeof fetch);
    /** The operation is found only under the caller's explicit profile (OWNR 4.1). */
    status(profile: string, operationId: string): Promise<{
        kind: "relay_provider_status";
        operationId: string;
        provider: "relay";
        sourceChainId: 1 | 8453 | 42161 | 56;
        destinationChainId: 1 | 8453 | 137 | 56 | 143 | 4326;
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
    /** One provider GET for an operation its caller already loaded under the explicit profile. */
    statusOf(operation: RelayUnsignedOperation): Promise<{
        kind: "relay_provider_status";
        operationId: string;
        provider: "relay";
        sourceChainId: 1 | 8453 | 42161 | 56;
        destinationChainId: 1 | 8453 | 137 | 56 | 143 | 4326;
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
