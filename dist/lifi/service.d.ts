import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import type { BridgeIntent } from "./operation-model.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import type { BridgeApprovalPort, BridgeCustodyPort, BridgeRpcFactory, LifiProviderPort } from "./ports.js";
import { BridgePreparation } from "./prepare.js";
import { type StoredPublicBridgeOperation, type BridgeReceipt } from "./receipt.js";
export interface BridgeDependencies {
    readonly provider: LifiProviderPort;
    readonly rpcFor: BridgeRpcFactory;
    readonly custody: BridgeCustodyPort;
    readonly approval?: BridgeApprovalPort;
}
export declare class BridgeService {
    private readonly context;
    readonly records: BridgeOperationRepository;
    readonly operations: OperationService;
    constructor(context: RuntimeContext);
    inventory(): Promise<{
        schema_version: string;
        provider: string;
        origin: string;
        observed: {
            [k: string]: {
                response_hash: string;
                provider_inventory: unknown;
                executable_capability: boolean;
            };
        };
        capability: {
            chains: {
                chain: string;
                name: string;
                native_coin: {
                    symbol: string;
                    coin_key: string;
                    decimals: 18;
                    bridgeable_principal: boolean;
                    quote_only: boolean;
                    role: string;
                    token: string;
                    tools: string[];
                    wrapped_native: `0x${string}`;
                    approval: string;
                    listing: "frozen_list";
                    peers: string[];
                };
                tokens: {
                    token: `0x${string}`;
                    symbol: string;
                    coin_key: string;
                    decimals: number;
                    upgradeability: "immutable" | "legacy_proxy" | "eip1967_proxy" | "beacon_proxy";
                    tools: string[];
                    approval: "standard" | "zero_first";
                    transfer_fee: "none" | "tether_fee_zero";
                    listing: "frozen_list" | "legacy_pinned";
                    peers: string[];
                }[];
            }[];
            tools: {
                tool: string;
                variant: string;
                decoder_implemented: boolean;
            }[];
            selected_direct_lane: {
                from_chain: string;
                from_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                to_chain: "solana-mainnet";
                to_token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
                provider: "Circle";
                protocol: "CCTP V2";
                delivery: "Forwarding Service";
                fee_quote: "signed_upfront_separate_from_burned_principal";
                selection: string;
                provider_route_state: "selected_design_unverified_for_execution";
                executable: false;
                missing_proof: string[];
            };
            candidate_lanes: ({
                from_chain: string;
                from_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                to_lifi_chain_id: 1151111081099710;
                to_token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
                provider_route_state: "unverified_by_static_capabilities";
                executable: false;
                missing_proof: string[];
                tool?: never;
            } | {
                from_chain: string;
                from_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                to_lifi_chain_id: 728126428;
                to_token: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
                tool: "near";
                provider_route_state: "unverified_by_static_capabilities";
                executable: false;
                missing_proof: string[];
            })[];
            route_executable: string;
            profiles: ({
                provider: string;
                custody: string;
                execution_owner: string;
                retry_owner: string;
                evidence_owner: string;
                implemented: boolean;
                unavailable_reason: null;
                prerequisites: string[];
            } | {
                provider: string;
                custody: string;
                execution_owner: string;
                retry_owner: string;
                evidence_owner: string;
                implemented: boolean;
                unavailable_reason: string;
                prerequisites: string[];
            })[];
            rpc_environment: {
                [k: string]: string;
            };
            inventory_only: ({
                tool: string;
                reason: string;
                asset?: never;
            } | {
                asset: string;
                reason: string;
                tool?: never;
            })[];
            fee_control: string;
            fee_headroom: {
                policy: "apn.bridge-fee-headroom.v1";
                headroom_bps: number;
                statement: string;
            };
            mainnet_acceptance: {
                complete: boolean;
                passed: number;
                required: number;
                named_human_acceptance: string;
            };
            next_actions: string[];
            profile?: string;
            profile_binding_inspected?: boolean;
            schema_version: string;
        };
        mainnet_acceptance: string;
    }>;
    routes(profile: string, request: BridgeIntent["materialization"]["request"]): Promise<{
        quote_hash: string;
        profile: string;
        request: import("./model.js").BridgeRouteRequest;
        response_hash: string;
        created_at: string;
        routes: {
            route_id: string;
            step_id: string;
            tool: string;
            quoted_output_atomic: string;
            minimum_output_atomic: string;
            preparable: boolean;
            executable: boolean;
            executability_gate: string;
            route_hash: string;
        }[];
        mainnet_acceptance: string;
    }>;
    prepare(input: Parameters<BridgePreparation["prepare"]>[0]): Promise<StoredPublicBridgeOperation>;
    approve(operationId: string): Promise<{
        rpc_origins: {
            source: string;
            destination: string;
        };
        deployments: {
            source: import("./model.js").BridgeDeploymentIdentity;
            destination: import("./model.js").BridgeDeploymentIdentity;
        };
        policy: {
            approved_at: string | null;
            expiry_enforced_before_first_send: boolean;
            inclusion_deadline: string;
            allowlist?: {
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
            identity: string;
            policy_hash: string;
        };
        created_at: string;
        updated_at: string;
        expires_at: string;
        next_actions: readonly string[];
        pre_sign_rpc_failure?: {
            schema_version: "apn.bridge-presign-rpc-failure.v1";
            phase: "pre_sign_guard";
            effect_role: "bridge" | "approval";
            stage: import("./operation-model.js").BridgePreSignRpcStage;
            chain_role: "source" | "destination";
            chain_id: number;
            category: import("./operation-model.js").BridgePreSignRpcCategory;
            method: import("./operation-model.js").BridgePreSignRpcMethod | null;
        };
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
    }>;
    resume(operationId: string): Promise<{
        rpc_origins: {
            source: string;
            destination: string;
        };
        deployments: {
            source: import("./model.js").BridgeDeploymentIdentity;
            destination: import("./model.js").BridgeDeploymentIdentity;
        };
        policy: {
            approved_at: string | null;
            expiry_enforced_before_first_send: boolean;
            inclusion_deadline: string;
            allowlist?: {
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
            identity: string;
            policy_hash: string;
        };
        created_at: string;
        updated_at: string;
        expires_at: string;
        next_actions: readonly string[];
        pre_sign_rpc_failure?: {
            schema_version: "apn.bridge-presign-rpc-failure.v1";
            phase: "pre_sign_guard";
            effect_role: "bridge" | "approval";
            stage: import("./operation-model.js").BridgePreSignRpcStage;
            chain_role: "source" | "destination";
            chain_id: number;
            category: import("./operation-model.js").BridgePreSignRpcCategory;
            method: import("./operation-model.js").BridgePreSignRpcMethod | null;
        };
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
    }>;
    status(operationId: string): Promise<StoredPublicBridgeOperation>;
    receipt(operationId: string): Promise<BridgeReceipt | Record<string, unknown>>;
    private dependencies;
    private preparation;
    private execution;
    private save;
    private followUsage;
    private locked;
}
