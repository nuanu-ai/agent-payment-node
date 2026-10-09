import { type Cleanup85RecoveryDependencies } from "./cleanup85-recovery-runtime.js";
import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { BridgeHttps } from "../lifi/https.js";
import type { StateStore } from "../state.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleOperationV1 } from "./operation-model.js";
export interface CirclePrepareInput {
    readonly profile: string;
    readonly destinationProfile: string;
    readonly destinationChain: CircleDestinationChain;
    readonly idempotencyKey: string;
}
/** A separate CCTP rail owns source custody and destination gas custody, never LI.FI source-only effects. */
export declare class CircleEvmService {
    private readonly state;
    private readonly env;
    private readonly now;
    private readonly ttyOptions;
    private readonly https;
    private readonly repo;
    private readonly usage;
    private readonly custody;
    private readonly operations;
    private readonly retirements;
    private readonly cleanup85Recovery;
    constructor(state: StateStore, wrapping: WrappingSecretPort, env: Readonly<Record<string, string | undefined>>, now?: () => number, ttyOptions?: TtyTransferApprovalOptions, https?: Pick<BridgeHttps, "request">, cleanup85Dependencies?: Cleanup85RecoveryDependencies);
    prepare(input: CirclePrepareInput): Promise<CircleOperationV1>;
    status(id: string): Promise<{
        cleanup85_recovery?: {
            cleanup86?: {
                intentHash: string;
                envelopeHash: string;
                effect: import("./cleanup86-store.js").Cleanup86Effect | null;
                signClaimed: boolean;
                sendClaimed: boolean;
                materialMetadata: {
                    transactionHash: Hex;
                    materialHash: string;
                } | null;
                firstPublicFailure: unknown;
            };
            recoveryBinding: string;
            windowEndsAt: string | null;
        };
        first_public_effect_failure?: {} | undefined;
        next_actions: string[];
        external_fulfillment?: import("./external-proof.js").CircleExternalFulfillment;
        proof_class?: string;
        destination_finality_external?: string;
        controlled_destination_native_atomic?: string;
        source_budget_native_atomic?: string;
        source_actual_native_atomic?: string;
        destination_fee_payer?: `0x${string}`;
        cleanup_retirement_receipt?: import("./nonce-retirement-proof.js").CircleNonceRetirementProof;
        operation_id: string;
        kind: string;
        state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted" | "nonce_retired" | "external_fulfilled";
        terminal: boolean;
        source_profile: string;
        destination_profile: string;
        destination_chain: CircleDestinationChain;
        amount_atomic: string;
        minimum_output_atomic: string;
        effects: {
            role: import("./operation-model.js").CircleRole;
            phase: import("./operation-model.js").CircleEffectPhase;
            transaction_hash: `0x${string}` | null;
            actual_fee_atomic: string | null;
        }[];
        source_finality: "safe" | "finalized" | "included" | null;
        destination_finality: "safe" | "finalized" | "included" | null;
        nonce: `0x${string}` | null;
        residual_allowance_atomic: string;
        usage_finalized: boolean;
        integrity_hash: string;
    }>;
    prepareCleanup85Recovery(id: string): Promise<import("../circle-cleanup85-cancellation-contract.js").Cleanup85CancellationRequest>;
    cancelCleanup85(id: string): Promise<import("../circle-cleanup85-cancellation-contract.js").Cleanup85CancellationStatus>;
    approveCleanup86(id: string): Promise<CircleOperationV1>;
    approveSource(id: string): Promise<CircleOperationV1>;
    adoptExternalMint(id: string, transactionHash: Hex): Promise<CircleOperationV1>;
    approveMint(id: string): Promise<CircleOperationV1>;
    observe(id: string): Promise<CircleOperationV1>;
    refreshAttestation(id: string): Promise<CircleOperationV1>;
    cleanupNonce(id: string): Promise<CircleOperationV1>;
    cleanup(id: string): Promise<CircleOperationV1>;
    private required;
    private run;
    private assertPriorSourcesCanonical;
    private preflightDeployments;
    private preflightAttesters;
    private remotes;
    private api;
    private fee;
    private ports;
}
