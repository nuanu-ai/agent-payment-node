import { type CircleExternalMintNotice, type CircleFundingCommandResult } from "./funding-external-mint.js";
import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { BridgeHttps } from "../lifi/https.js";
import type { StateStore } from "../state.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleEffect } from "./operation-model.js";
import { type CircleFundingParameters } from "./funding-binding.js";
import { type CircleFundingOperationV2 } from "./funding-operation.js";
/** Assertion only: authority is issued privately after production foreground consent inside the locked service. */
export declare function assertCircleFundingRuntimeAuthority(state: StateStore, input: CircleFundingOperationV2, effectInput: CircleEffect): void;
export interface CircleFundingApprovalOptions {
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
}
export interface CircleFundingPrepareInput {
    readonly profile: string;
    readonly destinationProfile: string;
    readonly destinationChain: CircleDestinationChain;
    readonly idempotencyKey: string;
    readonly funding: CircleFundingParameters;
}
export declare class CircleFundingEvmService {
    private readonly state;
    private readonly env;
    private readonly now;
    private readonly https;
    private readonly ttyOptions;
    private readonly repo;
    private readonly usage;
    private readonly custody;
    private readonly operations;
    constructor(state: StateStore, wrapping: WrappingSecretPort, env: Readonly<Record<string, string | undefined>>, now?: () => number, ttyOptions?: CircleFundingApprovalOptions, https?: Pick<BridgeHttps, "request">);
    adoptExternalMint(id: string, transactionHash: Hex): Promise<CircleFundingOperationV2>;
    prepare(input: CircleFundingPrepareInput): Promise<CircleFundingOperationV2>;
    status(id: string): Promise<{
        next_actions: readonly string[];
        external_mint?: CircleExternalMintNotice;
        external_fulfillment?: import("./funding-external-proof.js").CircleFundingExternalFulfillment;
        proof_class?: string;
        controlled_destination_native_atomic?: string;
        external_destination_fee_payer?: `0x${string}`;
        operation_id: string;
        kind: string;
        state: "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "completed" | "cleaned" | "cancelled_unsubmitted" | "external_fulfilled" | "abandoned_unknown";
        terminal: boolean;
        source_profile: string;
        destination_profile: string;
        destination_chain: CircleDestinationChain;
        amount_atomic: string;
        minimum_output_atomic: string;
        maximum_issuer_fee_atomic: string;
        recipient: `0x${string}`;
        actual_economics: {
            asset: {
                symbol: string;
                decimals: number;
                source_chain: string;
                source_token: `0x${string}`;
                destination_chain: string;
                destination_token: `0x${string}`;
            };
            actual_source_gross_atomic: string | null;
            source_burn_transaction_hash: `0x${string}` | null;
            source_burn_finality: "safe" | "included" | "finalized" | null;
            actual_destination_net_atomic: string | null;
            actual_issuer_fee_atomic: string | null;
            destination_mint: "external" | "owned" | null;
            destination_mint_transaction_hash: `0x${string}` | null;
            destination_mint_finality: "safe" | "included" | "finalized" | null;
        };
        source_signing_expires_at: string;
        effects: {
            role: import("./operation-model.js").CircleRole;
            phase: import("./operation-model.js").CircleEffectPhase;
            transaction_hash: `0x${string}` | null;
            actual_fee_atomic: string | null;
        }[];
        source_finality: "safe" | "included" | "finalized" | null;
        destination_finality: "safe" | "included" | "finalized" | null;
        residual_allowance_atomic: string;
        usage_finalized: boolean;
        integrity_hash: string;
    }>;
    approveSource(id: string): Promise<CircleFundingCommandResult>;
    approveMint(id: string): Promise<CircleFundingCommandResult>;
    observe(id: string): Promise<CircleFundingCommandResult>;
    refreshAttestation(id: string): Promise<CircleFundingCommandResult>;
    cleanup(id: string): Promise<CircleFundingCommandResult>;
    private required;
    /** A mint someone else relayed, found during the command, is adopted after its locks are released (adoption takes its own). */
    private run;
    private preflightDeployments;
    private preflightAttesters;
    private remotes;
    private api;
    private fee;
    private sourceAccount;
    private ports;
}
