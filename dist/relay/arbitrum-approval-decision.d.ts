import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { StateStore } from "../state.js";
import { RelayArbitrumApprovalPreflightReader } from "./arbitrum-approval-preflight.js";
export interface RelayArbitrumApprovalDecisionPorts {
    readonly activePolicy?: (profile: string, now: Date) => Promise<ActiveAssetPolicy | null>;
    readonly dailyUsage?: (owner: string, now: Date) => Promise<string>;
    readonly now?: () => Date;
}
export declare class RelayArbitrumApprovalDecisionService {
    private readonly state;
    private readonly reader;
    private readonly ports;
    constructor(state: StateStore, reader: Pick<RelayArbitrumApprovalPreflightReader, "read">, ports?: RelayArbitrumApprovalDecisionPorts);
    decide(profile: string, operationId: string): Promise<{
        operationId: string;
        profile: string;
        state: "approval_skipped" | "approval_required" | "preflight_blocked";
        reason: string;
        approvalRequired: boolean;
        allowanceAtomic: string;
        observationBlockNumber: string;
        observationBlockHash: `0x${string}`;
        confirmedNonce: string;
        pendingNonce: string;
        baseFeePerGas: string;
        reasons: readonly string[];
        journalIntegrityHash: string | null;
        proofClass: "read_only_rpc_observation" | "canonical_allowance_observation";
        executionAdmitted: false;
        nextActions: readonly [];
    }>;
}
