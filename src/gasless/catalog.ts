import { canonicalProfile } from "../wallet-policy.js";
import { GASLESS_DEPLOYMENTS } from "./registry.js";

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
      { provider: "metamask-agent-wallet", custody: "provider_owned", adapter: "unavailable", mainnet_acceptance: "open",
        reason: "bounded_gasless_provider_adapter_required" },
      { provider: "metamask-smart-account", custody: "provider_owned_session_grant", adapter: "unavailable", mainnet_acceptance: "open",
        reason: "fee_from_principal_execution_and_grant_contract_required" },
      { provider: "coinbase-agentic-wallet", custody: "provider_owned", adapter: "unavailable", mainnet_acceptance: "open",
        reason: "public_quote_cap_and_recoverable_send_contract_required" },
    ],
    semantics: { amount: "gross_USDC_including_fee_budget", maximum_fee: "USDC", minimum_received: "USDC",
      recipient_amount: "gross_minus_frozen_fee_budget", unused_fee_budget: "remains_with_sender",
      sender_native_gas_required: false, failed_transfer_can_charge_USDC: true,
      persistent_EIP7702_delegation: true, automatic_native_fallback: false, x402_support_implied: false },
    approval: "foreground_terminal_per_operation", proof_class: "static_gasless_capabilities",
    next_actions: ["apn gasless transfer prepare --help"] };
}
