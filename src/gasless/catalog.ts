import { canonicalProfile } from "../wallet-policy.js";
import { GASLESS_DEPLOYMENTS } from "./registry.js";
import { metaMaskGaslessNetworks } from "../metamask-gasless/catalog.js";

export function gaslessCapabilities(profile?: string) {
  return { family: "gasless_transfer", purpose: "same_chain_USDC_transfer_with_fee_from_gross",
    profile: profile === undefined ? null : canonicalProfile(profile), profile_binding_inspected: false,
    networks: GASLESS_DEPLOYMENTS.map((r) => ({ chain_id: r.chainId, name: r.network, token: r.token,
      symbol: "USDC", decimals: 6, rpc_environment: r.rpcEnv, bundler_environment: r.bundlerEnv,
      public_bundler_default: r.publicBundlerUrl, deployment_evidence_hash: r.evidenceHash,
      executable_adapter: true, action_time_verification_required: true, mainnet_acceptance: "open" })),
    profiles: [
      { provider: "local", custody: "local_software", adapter: "implemented", mainnet_acceptance: "open",
        reason: "existing_local_wallet_with_Circle_USDC_paymaster_and_EIP7702" },
      { provider: "metamask-agent-wallet", custody: "provider_managed_server_wallet", adapter: "implemented", mainnet_acceptance: "open",
        reason: "existing_server_wallet_public_SDK_one_exact_gross_minus_fee_batch" },
      { provider: "metamask-smart-account", custody: "provider_owned_session_grant", adapter: "unavailable", mainnet_acceptance: "open",
        reason: "fee_from_principal_execution_and_grant_contract_required" },
      { provider: "coinbase-agentic-wallet", custody: "provider_owned", adapter: "unavailable", mainnet_acceptance: "open",
        reason: "public_quote_cap_and_recoverable_send_contract_required" },
    ],
    provider_networks: { local: GASLESS_DEPLOYMENTS.map(r => r.chainId), "metamask-agent-wallet": metaMaskGaslessNetworks(),
      "metamask-smart-account": [], "coinbase-agentic-wallet": [] },
    provider_semantics: { "metamask-agent-wallet": { amount: "exact_gross_USDC_equals_net_plus_fee",
      fee: "frozen_quote_in_canonical_USDC", unused_gross_atomic: "0", refund_atomic: "0",
      terminal_states: ["completed", "failed_before_effect"], one_dispatch: true,
      recovery_after_dispatch: "read_only_provider_and_independent_chain_observation",
      apn_deadline: "first_dispatch_only", onchain_permission_expiry: false, persistent_designation: true,
      provider_status_is_settlement_proof: false } },
    semantics: { amount: "gross_USDC_including_fee_budget", maximum_fee: "USDC", minimum_received: "USDC",
      recipient_amount: "gross_minus_frozen_fee_budget", unused_fee_budget: "remains_with_sender",
      sender_native_gas_required: false, failed_transfer_can_charge_USDC: true,
      persistent_EIP7702_delegation: true, automatic_native_fallback: false, x402_support_implied: false },
    approval: "foreground_terminal_per_operation", proof_class: "static_gasless_capabilities",
    next_actions: ["apn gasless transfer prepare --help"] };
}
