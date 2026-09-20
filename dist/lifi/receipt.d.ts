import type { BridgeOperationRecord } from "./operation-model.js";
export declare function bridgeNextActions(op: BridgeOperationRecord): readonly string[];
export declare function bridgeProofClass(op: BridgeOperationRecord): string;
export declare function publicBridgeOperation(op: BridgeOperationRecord): {
    kind: "bridge_route";
    schema_version: "apn.bridge-operation.v1";
    operation_id: string;
    profile: string;
    provider: "local";
    custody: "local_software";
    execution_owner: string;
    retry_owner: string;
    evidence_owner: string;
    fingerprint: string;
    state: import("./operation-model.js").BridgeState;
    terminal: boolean;
    proof_class: string;
    reason: string;
    route: {
        route_id: string;
        step_id: string;
        tool: import("./model.js").BridgeTool;
        quote_hash: string;
        request_hash: string;
        response_hash: string;
        route_hash: string;
        step_hash: string;
        materialized_step_hash: string;
        transaction_digest: string;
        lifi_transaction_id: `0x${string}`;
        included_step_identities: readonly string[];
    };
    asset: {
        from: {
            chain: string;
            token: string;
            symbol: string;
            coin_key: string;
            decimals: number;
            upgradeability: string;
            approval: string;
            native_coin: {
                symbol: string;
                decimals: 18;
            };
        };
        to: {
            chain: string;
            token: string;
            symbol: string;
            coin_key: string;
            decimals: number;
            upgradeability: string;
            approval: string;
            native_coin: {
                symbol: string;
                decimals: 18;
            };
        };
        native_principal_admitted: boolean;
    };
    transfer: {
        sender: `0x${string}`;
        quoted_output_atomic: string;
        minimum_output_atomic: string;
        actual_source_atomic: string | null;
        actual_output_atomic: string | null;
        allowance_atomic_at_prepare: string;
        spender: `0x${string}`;
        fromChainId: import("./chains.js").BridgeChainId;
        toChainId: import("./chains.js").BridgeChainId;
        fromToken: import("../model.js").Address;
        toToken: import("../model.js").Address;
        amountAtomic: string;
        recipient: import("../model.js").Address;
        minOutputAtomic: string;
        maxNativeDebitWei: string;
        maxRouteFeeAtomic: string;
        slippageBps: number;
    };
    fees: {
        declared: readonly import("./model.js").BridgeFee[];
        implicit_protocol_token_fee_atomic: string;
        fee_headroom: {
            policy: "apn.bridge-fee-headroom.v1";
            headroom_bps: number;
            approved_maximum_execution_fee_wei: string;
            quoted_execution_fee_wei: string;
            statement: string;
        };
        token_loss_bound_atomic: string;
        native_debit_cap_wei: string;
        total_native_fee_enforced_onchain: boolean;
        native_value_refund_verified: boolean;
        approval_gas_nonrefundable: boolean;
        known_source_fees_wei: string;
        actual_source_fees_wei: string | null;
        unresolved_source_fee_effects: {
            role: "bridge" | "approval";
            transaction_hash: `0x${string}` | null;
            quoted_fee_wei: string;
            included_fee_wei: string | null;
        }[];
    };
    effects: {
        role: "bridge" | "approval";
        phase: import("./operation-model.js").BridgeEffectPhase;
        envelope_hash: string;
        transaction_hash: `0x${string}` | null;
        submission_attempts: 0 | 1;
        submitted_at: string | null;
        to: `0x${string}`;
        value_atomic: string;
        economics: import("../model.js").Economics;
        fee_quote: import("../evm-ports.js").EvmFeeQuote;
        gas_ceiling_provisional_at_consent: boolean;
        fee_ceiling: import("./model.js").BridgeFeeCeiling;
        included_proof: import("./model.js").BridgeTransactionProof | null;
        safe_proof: import("./model.js").BridgeTransactionProof | null;
    }[];
    source_proof: import("./model.js").BridgeSourceProof | null;
    destination_proof: import("./operation-model.js").BridgeVerifiedDestinationProof | null;
    provider_observation: import("./model.js").BridgeProviderObservation | null;
    residual_allowance: import("./model.js").BridgeResidualAllowance | null;
    rpc_origins: {
        source: string;
        destination: string;
    };
    deployments: {
        source: import("./model.js").BridgeDeploymentIdentity;
        destination: import("./model.js").BridgeDeploymentIdentity;
    };
    policy: {
        identity: string;
        policy_hash: string;
        allowlist: {
            schema_version: "apn.bridge-allowlist.v1";
            policy_digest: string;
            policy_revision: number;
            account: string;
            self_recipient: string;
            chain: string;
            asset: Readonly<{
                kind: "native";
                identifier: null;
            } | {
                kind: "token";
                identifier: string;
            }>;
            amount_atomic: string;
            mechanism: Readonly<{
                provider: "lifi";
                reference: "across-v4";
            }>;
            reservation_id: string | null;
        } | null;
        approved_at: string | null;
        expiry_enforced_before_first_send: boolean;
        inclusion_deadline: string;
    };
    created_at: string;
    updated_at: string;
    expires_at: string;
    next_actions: readonly string[];
};
export declare function bridgeReceipt(op: BridgeOperationRecord): {
    receipt_hash: string;
    schema_version: "apn.bridge-receipt.v1";
    operation_binding_hash: string;
    kind: "bridge_route";
    operation_id: string;
    profile: string;
    provider: "local";
    custody: "local_software";
    execution_owner: string;
    retry_owner: string;
    evidence_owner: string;
    fingerprint: string;
    state: import("./operation-model.js").BridgeState;
    terminal: boolean;
    proof_class: string;
    reason: string;
    route: {
        route_id: string;
        step_id: string;
        tool: import("./model.js").BridgeTool;
        quote_hash: string;
        request_hash: string;
        response_hash: string;
        route_hash: string;
        step_hash: string;
        materialized_step_hash: string;
        transaction_digest: string;
        lifi_transaction_id: `0x${string}`;
        included_step_identities: readonly string[];
    };
    asset: {
        from: {
            chain: string;
            token: string;
            symbol: string;
            coin_key: string;
            decimals: number;
            upgradeability: string;
            approval: string;
            native_coin: {
                symbol: string;
                decimals: 18;
            };
        };
        to: {
            chain: string;
            token: string;
            symbol: string;
            coin_key: string;
            decimals: number;
            upgradeability: string;
            approval: string;
            native_coin: {
                symbol: string;
                decimals: 18;
            };
        };
        native_principal_admitted: boolean;
    };
    transfer: {
        sender: `0x${string}`;
        quoted_output_atomic: string;
        minimum_output_atomic: string;
        actual_source_atomic: string | null;
        actual_output_atomic: string | null;
        allowance_atomic_at_prepare: string;
        spender: `0x${string}`;
        fromChainId: import("./chains.js").BridgeChainId;
        toChainId: import("./chains.js").BridgeChainId;
        fromToken: import("../model.js").Address;
        toToken: import("../model.js").Address;
        amountAtomic: string;
        recipient: import("../model.js").Address;
        minOutputAtomic: string;
        maxNativeDebitWei: string;
        maxRouteFeeAtomic: string;
        slippageBps: number;
    };
    fees: {
        declared: readonly import("./model.js").BridgeFee[];
        implicit_protocol_token_fee_atomic: string;
        fee_headroom: {
            policy: "apn.bridge-fee-headroom.v1";
            headroom_bps: number;
            approved_maximum_execution_fee_wei: string;
            quoted_execution_fee_wei: string;
            statement: string;
        };
        token_loss_bound_atomic: string;
        native_debit_cap_wei: string;
        total_native_fee_enforced_onchain: boolean;
        native_value_refund_verified: boolean;
        approval_gas_nonrefundable: boolean;
        known_source_fees_wei: string;
        actual_source_fees_wei: string | null;
        unresolved_source_fee_effects: {
            role: "bridge" | "approval";
            transaction_hash: `0x${string}` | null;
            quoted_fee_wei: string;
            included_fee_wei: string | null;
        }[];
    };
    effects: {
        role: "bridge" | "approval";
        phase: import("./operation-model.js").BridgeEffectPhase;
        envelope_hash: string;
        transaction_hash: `0x${string}` | null;
        submission_attempts: 0 | 1;
        submitted_at: string | null;
        to: `0x${string}`;
        value_atomic: string;
        economics: import("../model.js").Economics;
        fee_quote: import("../evm-ports.js").EvmFeeQuote;
        gas_ceiling_provisional_at_consent: boolean;
        fee_ceiling: import("./model.js").BridgeFeeCeiling;
        included_proof: import("./model.js").BridgeTransactionProof | null;
        safe_proof: import("./model.js").BridgeTransactionProof | null;
    }[];
    source_proof: import("./model.js").BridgeSourceProof | null;
    destination_proof: import("./operation-model.js").BridgeVerifiedDestinationProof | null;
    provider_observation: import("./model.js").BridgeProviderObservation | null;
    residual_allowance: import("./model.js").BridgeResidualAllowance | null;
    rpc_origins: {
        source: string;
        destination: string;
    };
    deployments: {
        source: import("./model.js").BridgeDeploymentIdentity;
        destination: import("./model.js").BridgeDeploymentIdentity;
    };
    policy: {
        identity: string;
        policy_hash: string;
        allowlist: {
            schema_version: "apn.bridge-allowlist.v1";
            policy_digest: string;
            policy_revision: number;
            account: string;
            self_recipient: string;
            chain: string;
            asset: Readonly<{
                kind: "native";
                identifier: null;
            } | {
                kind: "token";
                identifier: string;
            }>;
            amount_atomic: string;
            mechanism: Readonly<{
                provider: "lifi";
                reference: "across-v4";
            }>;
            reservation_id: string | null;
        } | null;
        approved_at: string | null;
        expiry_enforced_before_first_send: boolean;
        inclusion_deadline: string;
    };
    created_at: string;
    updated_at: string;
    expires_at: string;
    next_actions: readonly string[];
};
export type BridgeReceipt = ReturnType<typeof bridgeReceipt>;
