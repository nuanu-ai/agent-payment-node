import type { MetaMaskGaslessObservationRpcFactory } from "./ports.js";
import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import type { MetaMaskGaslessChainId } from "./model.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessRepositoryPort, MetaMaskGaslessRpcFactory } from "./ports.js";
import { MetaMaskGaslessPreparation } from "./prepare.js";
import { type MetaMaskRevocationDependencies } from "./revocation/service.js";
export interface MetaMaskGaslessDependencies {
    readonly rpcFor: MetaMaskGaslessRpcFactory;
    readonly observationRpcFor?: MetaMaskGaslessObservationRpcFactory;
    readonly provider: MetaMaskGaslessProviderPort;
    readonly approval?: MetaMaskGaslessApprovalPort;
    readonly records?: MetaMaskGaslessRepositoryPort;
    /** Foreground consent and the owner's wallet CLI, present only for `gasless transfer revoke`. */
    readonly revocation?: MetaMaskRevocationDependencies;
}
export declare class MetaMaskGaslessService {
    private readonly context;
    readonly records: MetaMaskGaslessRepositoryPort;
    readonly operations: OperationService;
    constructor(context: RuntimeContext);
    balance(profile: string, chainId: MetaMaskGaslessChainId): Promise<{
        profile: string;
        provider: string;
        chain_id: 1 | 10 | 8453 | 42161 | 137 | 59144 | 143 | 1329;
        token: `0x${string}`;
        symbol: string;
        decimals: number;
        address: `0x${string}`;
        balance_atomic: string;
        designation: "empty" | "pinned";
        block: import("./model.js").MetaMaskGaslessBlock;
        observed_at: string;
        rpc_origin: string;
        endpoint_hash: string;
        sender_native_balance_required: boolean;
        proof_class: string;
    }>;
    prepare(input: Parameters<MetaMaskGaslessPreparation["prepare"]>[0]): Promise<{
        unresolved_beside?: {
            readonly operations: readonly import("./siblings.js").MetaMaskGaslessSiblingOutput[];
            readonly warning: string;
        };
        schema_version: typeof import("./operation-model.js").MM_OPERATION_VERSION;
        kind: typeof import("./operation-model.js").MM_OPERATION_KIND;
        operation_id: string;
        profile: string;
        profile_hash: string;
        provider: "metamask-agent-wallet";
        custody: "provider_managed_server_wallet";
        execution_owner: "provider";
        retry_owner: "apn_observation_only_after_attempt";
        evidence_owner: "configured_chain_rpc";
        fingerprint: string;
        state: import("./model.js").MetaMaskGaslessState;
        terminal: boolean;
        reason: import("./reasons.js").MetaMaskGaslessReason;
        proof_class: "durable_pre_effect" | "effect_observation_pending" | "rpc_safe_correlated" | "rpc_finalized_correlated" | "owner_acknowledgement_only";
        transfer: {
            readonly chain_id: MetaMaskGaslessChainId;
            readonly token: import("../model.js").Address;
            readonly symbol: "USDC";
            readonly decimals: 6;
            readonly sender: import("../model.js").Address;
            readonly recipient: import("../model.js").Address;
            readonly fee_recipient: import("../model.js").Address | null;
            readonly fee_mode?: "sponsored";
            readonly requested_fixed_net_atomic?: string;
            readonly maximum_gross_atomic?: string;
            readonly gross_atomic: string;
            readonly user_max_fee_atomic: string;
            readonly minimum_received_atomic: string;
            readonly frozen_net_atomic: string;
            readonly frozen_fee_atomic: string;
            readonly actual_delivered_atomic: string | null;
            readonly actual_sender_debit_atomic: string | null;
        };
        fees: {
            readonly token: import("../model.js").Address;
            readonly actual_fee_atomic: string | null;
            readonly refund_atomic: string | null;
            readonly unused_gross_atomic: string | null;
            readonly approved_sender_native_debit_wei: "0";
            readonly proven_sender_native_debit_wei: "0" | null;
            readonly native_gas_payer: import("../model.js").Address | null;
        };
        permission: {
            readonly initial_designation: "empty" | "pinned";
            readonly observed_designation: "pinned" | null;
            readonly designation_persists: true;
            readonly delegation_hash: import("../model.js").Hex;
            readonly signing_digest: import("../model.js").Hex;
            readonly one_use_status: "not_dispatched" | "possibly_live" | "consumed" | "disabled_unused";
            readonly onchain_expiry: false;
            readonly guard_held: boolean;
        };
        provider_binding: import("./model.js").MetaMaskGaslessBinding;
        provider_request_id_hash: string;
        submission_attempts: 0 | 1;
        transaction_hash: import("../model.js").Hex | null;
        settlement: import("./model.js").MetaMaskGaslessSettlement | null;
        scan_cursor: import("./model.js").MetaMaskGaslessCursor;
        endpoint_origin: string;
        endpoint_hash: string;
        approved_at: string | null;
        created_at: string;
        updated_at: string;
        expires_at: string;
        next_actions: readonly string[];
    }>;
    /**
     * A lost provider session is normally renewed with the foreground wallet connect handoff, but wallet lifecycle
     * changes wait for every unresolved operation of the profile. Point at the operation that holds the profile first,
     * instead of at a command that would only be refused; any steps of the refusal's own follow, since they end in a
     * wallet connect that waits for it.
     */
    private sessionGuidance;
    approve(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    resume(operationId: string, observationRpcEnv?: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    /** The owner's on-chain disable of a disclosed delegation whose outcome is still unproved (no journal write). */
    revoke(operationId: string): Promise<Readonly<Record<string, unknown>>>;
    /**
     * The disable is the server wallet's own transaction on its account nonce: an unresolved operation of another family
     * on the chain and account, in any profile bound to it, blocks it; the account's MetaMask gasless transfers never do.
     * The caller holds the account's evm-owner lock.
     */
    private assertRevokeAvailable;
    /** The account's other MetaMask gasless transfers this one proceeds beside (dispatched, outcome unknown). */
    private siblings;
    status(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    receipt(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessReceipt>;
    /** A guard that found the login's project without the bound wallet also names both ways out, with this call's output only. */
    private project;
    private dependencies;
    private execution;
    /** Observation only; an owner-named RPC replaces the frozen endpoint for the read, never for approval or dispatch. */
    private observation;
    private readonly save;
    private locked;
}
