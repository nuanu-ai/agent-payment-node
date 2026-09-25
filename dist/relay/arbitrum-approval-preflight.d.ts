/** Read-only approval boundary for a saved Relay Arbitrum operation. Never signs, sends, or admits execution. */
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type RelayArbitrumReadCall } from "./arbitrum-usdc-source-draft.js";
export interface RelayArbitrumApprovalPreflightPorts {
    readonly batch: (calls: readonly RelayArbitrumReadCall[]) => Promise<readonly unknown[]>;
    readonly now: () => Date;
}
/** Three read-only batches total. The third binds nonce and block base fee to the funding block. */
export declare function preflightRelayArbitrumApproval(operation: RelayUnsignedOperation, active: ActiveAssetPolicy, publicAccount: string, dailyUsageAtomic: string, now: Date, ports: RelayArbitrumApprovalPreflightPorts): Promise<Readonly<{
    kind: "relay_arbitrum_read_only_approval_preflight";
    operationId: string;
    operationIntegrityHash: string;
    draftIntegrityHash: string;
    quoteDigest: string;
    policyDigest: string;
    policyRevision: number;
    sourceChainId: 42161;
    sourceAccount: string;
    observationBlockNumber: string;
    observationBlockHash: `0x${string}`;
    tokenBalanceAtomic: string;
    allowanceAtomic: string;
    nativeBalanceWei: string;
    requiredNativeWei: string;
    approvalRequired: boolean;
    confirmedNonce: string;
    pendingNonce: string;
    baseFeePerGas: string;
    quotedMaxFeePerGas: string;
    quotedMaxPriorityFeePerGas: string;
    observedAt: string;
    readOnlyConditionsSatisfied: boolean;
    reasons: readonly string[];
    rpcBatches: 3;
    proofClass: "read_only_rpc_observation";
    executionAdmitted: false;
    nextActions: readonly [];
}>>;
/** Optional transport adapter; one persisted guard covers all three physical POSTs. */
export declare class RelayArbitrumApprovalPreflightReader {
    private readonly url;
    private readonly state;
    private readonly guardFactory;
    private readonly holdAfterPost;
    private readonly rpc;
    constructor(url: string, state: StateStore, rpc?: Pick<HttpsBaseRpc, "batchCall">, guardFactory?: () => EvmDirectRpcGuard, holdAfterPost?: () => Promise<void>);
    read(operation: RelayUnsignedOperation, active: ActiveAssetPolicy, publicAccount: string, dailyUsageAtomic: string, now: Date, clock?: () => Date): Promise<Readonly<{
        kind: "relay_arbitrum_read_only_approval_preflight";
        operationId: string;
        operationIntegrityHash: string;
        draftIntegrityHash: string;
        quoteDigest: string;
        policyDigest: string;
        policyRevision: number;
        sourceChainId: 42161;
        sourceAccount: string;
        observationBlockNumber: string;
        observationBlockHash: `0x${string}`;
        tokenBalanceAtomic: string;
        allowanceAtomic: string;
        nativeBalanceWei: string;
        requiredNativeWei: string;
        approvalRequired: boolean;
        confirmedNonce: string;
        pendingNonce: string;
        baseFeePerGas: string;
        quotedMaxFeePerGas: string;
        quotedMaxPriorityFeePerGas: string;
        observedAt: string;
        readOnlyConditionsSatisfied: boolean;
        reasons: readonly string[];
        rpcBatches: 3;
        proofClass: "read_only_rpc_observation";
        executionAdmitted: false;
        nextActions: readonly [];
    }>>;
}
