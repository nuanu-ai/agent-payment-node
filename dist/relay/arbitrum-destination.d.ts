import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type RelayEthereumUsdcCreditProof, type RelayEthereumUsdcProofPorts } from "./ethereum-usdc-credit-proof.js";
import type { RelayKeylessStatusService } from "./status.js";
export interface RelayArbitrumDestinationPorts {
    readonly status: Pick<RelayKeylessStatusService, "statusOf">;
    /** A fresh bounded Ethereum read session for each proof. */
    readonly ethereum: () => RelayEthereumUsdcProofPorts;
    readonly now?: () => Date;
}
export type RelayArbitrumDestinationState = "deposit_source_confirmed" | "provider_candidate_unproven" | "recipient_credit_observed" | "operational_acceptance";
export interface RelayArbitrumDestinationResult {
    readonly state: RelayArbitrumDestinationState;
    readonly reason: string;
    readonly providerStatus: string | null;
    readonly providerStatusBound: boolean;
    readonly destinationProof: RelayEthereumUsdcCreditProof | Readonly<{
        status: string;
        reason: string;
    }> | null;
    readonly destinationDeliveryProven: boolean;
    readonly operationalAcceptance: boolean;
    readonly terminal: boolean;
}
export declare class RelayArbitrumDestinationObserver {
    private readonly root;
    private readonly ports;
    private readonly records;
    constructor(root: string, ports: RelayArbitrumDestinationPorts);
    private accepted;
    private open;
    /** `sourceHash` is the deposit the caller just read as confirmed from the operation's own source journal. */
    observe(op: RelayUnsignedOperation, sourceHash: string): Promise<RelayArbitrumDestinationResult>;
}
