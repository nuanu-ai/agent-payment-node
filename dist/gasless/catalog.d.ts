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
