import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "./https.js";
import type { CircleV2SourcePreparation } from "./circle-v2-source-preparation.js";
export interface CircleV2SourceSubmitRequest {
    readonly profile: string;
    readonly expectedPayer: string;
    readonly recipientOwner: string;
    readonly recipientSetup: "existing_ata" | "create_ata";
    readonly amountAtomic: string;
    readonly maxSourceFeeAtomic: string;
    readonly maxAllowanceAtomic: string;
    readonly maxGasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly maxNativeDebitWei: string;
    readonly idempotencyKey: string;
}
export interface CircleV2SourceResult {
    readonly operationId: string;
    readonly sourceTransactionHash: Hex;
    readonly sourceState: "submitted_pending" | "unknown_finality";
    readonly submissionAttempts: 1;
    readonly bridgeCompletion: false;
    readonly circleAttestationObserved: false;
    readonly solanaDestinationFinalized: false;
}
export interface CircleV2SourceApprovalPort {
    approve(preparation: CircleV2SourcePreparation): Promise<void>;
}
/** Production adapters use one pinned HTTPS Circle origin and one explicitly configured Base RPC origin. */
export declare class CircleV2SourceService {
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly approval;
    private readonly transport;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, approval: CircleV2SourceApprovalPort, transport?: BridgeHttps);
    submit(request: CircleV2SourceSubmitRequest): Promise<CircleV2SourceResult>;
}
/** Minimal EIP-1898 Base reader. Every token and native balance read uses the same canonical block hash. */
export declare class CircleBaseJsonRpc {
    private readonly https;
    readonly origin: string;
    private readonly endpoint;
    private sequence;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
    readSource(query: Readonly<{
        payer: string;
        token: string;
        spender: string;
        to: string;
        data: string;
        valueAtomic: string;
        draftBlockNumber: string;
        freshBlockNumber: string;
        freshBlockHash: string;
    }>): Promise<{
        chainId: 8453;
        payer: `0x${string}`;
        draftBlockHash: `0x${string}`;
        blockNumber: string;
        blockHash: `0x${string}`;
        latestNonceAtomic: string;
        pendingNonceAtomic: string;
        usdcBalanceAtomic: string;
        usdcAllowanceAtomic: string;
        nativeBalanceWei: string;
        gasLimitAtomic: string;
        maxFeePerGasWei: string;
        maxPriorityFeePerGasWei: string;
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
    }>;
    send(raw: Hex): Promise<Hex>;
}
