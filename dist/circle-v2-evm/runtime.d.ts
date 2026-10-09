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
    constructor(state: StateStore, wrapping: WrappingSecretPort, env: Readonly<Record<string, string | undefined>>, now?: () => number, ttyOptions?: TtyTransferApprovalOptions, https?: Pick<BridgeHttps, "request">);
    prepare(input: CirclePrepareInput): Promise<CircleOperationV1>;
    status(id: string): Promise<{
        next_actions: string[];
        cleanup_retirement_receipt?: import("./nonce-retirement-proof.js").CircleNonceRetirementProof;
        operation_id: string;
        kind: string;
        state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted" | "nonce_retired";
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
    approveSource(id: string): Promise<CircleOperationV1>;
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
