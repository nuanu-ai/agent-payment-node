import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT } from "./arbitrum-usdc-ethereum-quote.js";
export declare const RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE = "arbitrum-usdc-ethereum-usdc-source-draft-v1";
export interface RelayArbitrumSourceDraftInput {
    readonly profile: string;
    readonly owner: string;
    readonly publicAccount: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maxProviderFeeAtomic: string;
    readonly maxApprovalNetworkFeeWei: string;
    readonly maxDepositNetworkFeeWei: string;
    readonly dailyUsageAtomic: string;
    readonly activePolicy: ActiveAssetPolicy;
    readonly rawQuote: unknown;
    readonly now: Date;
}
export interface RelayArbitrumSourceDraft {
    readonly schemaVersion: "apn.relay-arbitrum-source-draft.v1";
    readonly sourceChainId: 42161;
    readonly destinationChainId: 1;
    readonly sourceToken: typeof RELAY_ARBITRUM_USDC;
    readonly destinationToken: string;
    readonly recipient: typeof RELAY_ETHEREUM_USDC_RECIPIENT;
    readonly profile: string;
    readonly owner: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maxProviderFeeAtomic: string;
    readonly maxApprovalNetworkFeeWei: string;
    readonly maxDepositNetworkFeeWei: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly quoteDigest: string;
    readonly requestId: string;
    readonly orderId: string;
    readonly deadline: string;
    readonly createdAt: string;
    readonly rawQuote: unknown;
    readonly executionAdmitted: false;
    readonly nextActions: readonly [];
    readonly integrityHash: string;
}
export declare function createRelayArbitrumSourceDraft(input: RelayArbitrumSourceDraftInput): Promise<RelayArbitrumSourceDraft>;
export interface RelayArbitrumReadCall {
    readonly method: string;
    readonly params: readonly unknown[];
}
export interface RelayArbitrumSourcePreflightPorts {
    readonly batch: (calls: readonly RelayArbitrumReadCall[]) => Promise<readonly unknown[]>;
    readonly now: () => Date;
}
/** Two injected read-only batches, with EIP-1898 binding all account state to one canonical block hash. */
export declare function preflightRelayArbitrumSourceDraft(draft: RelayArbitrumSourceDraft, active: ActiveAssetPolicy, publicAccount: string, dailyUsageAtomic: string, now: Date, ports: RelayArbitrumSourcePreflightPorts): Promise<{
    kind: "relay_arbitrum_read_only_source_preflight";
    draftIntegrityHash: string;
    sourceChainId: 42161;
    sourceToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    sourceAccount: string;
    spender: string;
    observationBlockNumber: string;
    observationBlockHash: `0x${string}`;
    rpcBatches: 2;
    rpcMethods: 6;
    tokenBalanceAtomic: string;
    allowanceAtomic: string;
    nativeBalanceWei: string;
    approvalRequired: boolean;
    requiredNativeWei: string;
    fundingReasons: string[];
    fundingObserved: boolean;
    proofClass: "read_only_rpc_observation";
    executionAdmitted: false;
    nextActions: readonly [];
}>;
