import { canonicalProfile } from "../wallet-policy.js";
import { GASLESS_DEPLOYMENTS } from "./registry.js";
import { metaMaskGaslessNetworks } from "../metamask-gasless/catalog.js";
import { GASLESS_EIP7702_CHAINS } from "./validation.js";
import { saRegistry } from "../smart-account-gasless/registry.js";
import { AVALANCHE_FACILITATOR as AVAX } from "../facilitator-gasless/registry.js";

export function gaslessCapabilities(profile?: string) {
  return { family: "gasless_transfer", purpose: "same_chain_USDC_transfer_with_fee_from_gross",
    profile: profile === undefined ? null : canonicalProfile(profile), profile_binding_inspected: false,
    networks: GASLESS_DEPLOYMENTS.map((r) => ({ chain_id: r.chainId, name: r.network, token: r.token,
      symbol: "USDC", decimals: 6, rpc_environment: r.rpcEnv, bundler_environment: r.bundlerEnv,
      public_bundler_default: r.publicBundlerUrl, deployment_evidence_hash: r.evidenceHash,
      executable_adapter: GASLESS_EIP7702_CHAINS.includes(r.chainId),
      execution_unavailable_reason: GASLESS_EIP7702_CHAINS.includes(r.chainId) ? null : "gasless_eip7702_unavailable",
      action_time_verification_required: true, mainnet_acceptance: "open" })),
    profiles: [
      { provider: "local", custody: "local_software", adapter: "implemented", mainnet_acceptance: "open",
        reason: "existing_local_wallet_with_Circle_USDC_paymaster_and_EIP7702" },
      { provider: "metamask-agent-wallet", custody: "provider_managed_server_wallet", adapter: "implemented", mainnet_acceptance: "open",
        reason: "existing_server_wallet_public_SDK_one_exact_gross_minus_fee_batch" },
      { provider: "metamask-smart-account", custody: "provider_owned_session_grant", adapter: "implemented", mainnet_acceptance: "open",
        reason: "existing_owner_and_session_with_current_permission_and_external_facilitator_gas" },
      { provider: "coinbase-agentic-wallet", custody: "provider_owned", adapter: "implemented", mainnet_acceptance: "open",
        reason: "pinned_AWAL_Base_USDC_CDP_paymaster_with_positive_only_chain_recovery" },
    ],
    provider_networks: { local: [...GASLESS_EIP7702_CHAINS], "metamask-agent-wallet": metaMaskGaslessNetworks(),
      "metamask-smart-account": [{ chain_id: 8453, token: saRegistry(8453).token.address, symbol: "USDC", decimals: 6,
        executable_adapter: true, rpc_environment: saRegistry(8453).rpcEnv, action_time_verification_required: true,
        required_checks: ["current_bound_profile", "active_exact_root_permission", "root_nonce", "USDC_balance_and_allowance",
          "pinned_deployments", "fresh_public_facilitator_support"], sender_native_balance_required: false,
        mainnet_acceptance: "open", deployment_evidence_hash: saRegistry(8453).evidenceHash }], "coinbase-agentic-wallet": [
        { chain_id: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6,
          executable_adapter: true, provider_cli: "awal@2.12.1", gas_mechanism: "coinbase_cdp_paymaster",
          sender_token_fee_atomic: "0", sender_native_debit_wei: "0", action_time_verification_required: true,
          recovery: "bounded_positive_only_canonical_scan_from_frozen_safe_anchor", mainnet_acceptance: "open" }] },
    provider_semantics: { "metamask-agent-wallet": { amount: "exact_gross_USDC_equals_net_plus_fee",
      fee: "frozen_quote_in_canonical_USDC", unused_gross_atomic: "0", refund_atomic: "0",
      terminal_states: ["completed", "failed_before_effect"], one_dispatch: true,
      recovery_after_dispatch: "read_only_provider_and_independent_chain_observation",
      apn_deadline: "first_dispatch_only", onchain_permission_expiry: false, persistent_designation: true,
      provider_status_is_settlement_proof: false }, "metamask-smart-account": {
      amount: "exact_gross_USDC_equals_recipient_net", fee_atomic: "0", native_gas_payer: "public_facilitator",
      approved_owner_native_debit_wei: "0", approved_session_native_debit_wei: "0",
      terminal_states: ["completed", "failed_before_effect", "expired_unused"], one_signature: true,
      one_disclosure: true, one_settlement_dispatch: true, onchain_permission_expiry: true,
      recovery_after_exposure: "independent_chain_observation_only", provider_status_is_settlement_proof: false,
      accounting_before_independent_proof: "unknown", persistent_owner_designation: true }, "coinbase-agentic-wallet": {
      amount: "exact_gross_USDC_equals_recipient_net", fee_atomic: "0", native_gas_payer: "external_CDP_paymaster",
      approved_sender_native_debit_wei: "0", one_dispatch: true, recovery_after_dispatch: "independent_chain_observation_only",
      finite_negative_closure: false, ambiguous_guard_release: "canonical_positive_completion_only", provider_status_is_settlement_proof: false } },
    semantics: { amount: "gross_USDC_including_fee_budget", maximum_fee: "USDC", minimum_received: "USDC",
      recipient_amount: "gross_minus_frozen_fee_budget", unused_fee_budget: "remains_with_sender",
      sender_native_gas_required: false, failed_transfer_can_charge_USDC: true,
      persistent_EIP7702_delegation: true, automatic_native_fallback: false, x402_support_implied: false },
    local_facilitator: { provider: "local", custody: "local_software", route: "x402_exact_eip3009_public_facilitator",
      networks: [{ chain_id: AVAX.chainId, name: "Avalanche C-Chain", token: AVAX.token, symbol: "USDC", decimals: AVAX.decimals,
        rpc_environment: AVAX.rpcEnv, facilitator_origin: AVAX.facilitatorOrigin, approved_facilitator_signers: [...AVAX.approvedSigners],
        executable_adapter: true, action_time_verification_required: true, mainnet_acceptance: "open" }],
      semantics: { amount: "exact_gross_USDC_equals_recipient_net", fee_atomic: "0", native_gas_payer: "public_facilitator",
        approved_sender_native_debit_wei: "0", one_signature: true, one_verification: true, one_settlement_dispatch: true,
        authorization_validity_seconds: AVAX.validitySeconds, onchain_authorization_expiry: true, persistent_delegation: false,
        terminal_states: ["completed", "expired_unused", "failed_before_effect"], recovery_after_exposure: "finalized_chain_evidence_only",
        provider_status_is_settlement_proof: false, paid_facilitator_tier: false } },
    approval: "foreground_terminal_per_operation", proof_class: "static_gasless_capabilities",
    next_actions: ["apn gasless transfer prepare --help"] };
}
