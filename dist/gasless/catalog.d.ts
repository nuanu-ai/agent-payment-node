export declare function gaslessCapabilities(profile?: string): {
    family: string;
    purpose: string;
    profile: string | null;
    profile_binding_inspected: boolean;
    networks: {
        chain_id: import("./model.js").GaslessChainId;
        name: string;
        token: `0x${string}`;
        symbol: string;
        decimals: number;
        rpc_environment: string;
        bundler_environment: string;
        public_bundler_default: string;
        deployment_evidence_hash: string;
        executable_adapter: boolean;
        action_time_verification_required: boolean;
        mainnet_acceptance: string;
    }[];
    profiles: {
        provider: string;
        custody: string;
        adapter: string;
        mainnet_acceptance: string;
        reason: string;
    }[];
    provider_networks: {
        local: import("./model.js").GaslessChainId[];
        "metamask-agent-wallet": {
            chain_id: 1 | 8453 | 42161 | 10 | 137 | 143 | 1329 | 59144;
            name: string;
            token: `0x${string}`;
            symbol: string;
            decimals: number;
            rpc_environment: string;
            finality_tag: "safe" | "finalized";
            deployment_evidence_hash: string;
            executable_adapter: boolean;
            action_time_verification_required: boolean;
            mainnet_acceptance: string;
        }[];
        "metamask-smart-account": never[];
        "coinbase-agentic-wallet": never[];
    };
    provider_semantics: {
        "metamask-agent-wallet": {
            amount: string;
            fee: string;
            unused_gross_atomic: string;
            refund_atomic: string;
            terminal_states: string[];
            one_dispatch: boolean;
            recovery_after_dispatch: string;
            apn_deadline: string;
            onchain_permission_expiry: boolean;
            persistent_designation: boolean;
            provider_status_is_settlement_proof: boolean;
        };
    };
    semantics: {
        amount: string;
        maximum_fee: string;
        minimum_received: string;
        recipient_amount: string;
        unused_fee_budget: string;
        sender_native_gas_required: boolean;
        failed_transfer_can_charge_USDC: boolean;
        persistent_EIP7702_delegation: boolean;
        automatic_native_fallback: boolean;
        x402_support_implied: boolean;
    };
    approval: string;
    proof_class: string;
    next_actions: string[];
};
