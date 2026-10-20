import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "../circle-v2-evm/operation-model.js";
/** Frozen reader of the first public classified failure the deleted v1 runtime recorded (never request bodies, RPC params,
 * key or material bytes). Nothing writes it any more. */
export declare class CirclePublicFailureStore extends SecureStateStore {
    private path;
    read(op: CircleOperationV1): Promise<unknown | null>;
}
/** Status of a read-only v1 operation (`apn.circle-v2-evm-operation.v1`): the checked journal and its recorded failure. */
export declare function circleV1Status(root: string, op: CircleOperationV1): Promise<{
    first_public_effect_failure?: {} | undefined;
    next_actions: string[];
    external_fulfillment?: import("../circle-v2-evm/external-proof.js").CircleExternalFulfillment;
    proof_class?: string;
    destination_finality_external?: string;
    controlled_destination_native_atomic?: string;
    source_budget_native_atomic?: string;
    source_actual_native_atomic?: string;
    destination_fee_payer?: `0x${string}`;
    cleanup_retirement_receipt?: import("../circle-v2-evm/nonce-retirement-proof.js").CircleNonceRetirementProof;
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted" | "nonce_retired" | "external_fulfilled";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: import("../circle-v2-evm/catalog.js").CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
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
    effects: {
        role: import("../circle-v2-evm/operation-model.js").CircleRole;
        phase: import("../circle-v2-evm/operation-model.js").CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "safe" | "included" | "finalized" | null;
    destination_finality: "safe" | "included" | "finalized" | null;
    nonce: `0x${string}` | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
}>;
