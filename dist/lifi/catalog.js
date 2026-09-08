import { sha256 } from "../canonical.js";
import { canonicalProfile } from "../wallet-policy.js";
import { BRIDGE_CHAINS, BRIDGE_USDC, bridgeFailure, bridgeJson, bridgeRecord } from "./validation.js";
export function bridgeCapabilities(profile) {
    return { schema_version: "apn.bridge-capabilities.v1", ...(profile === undefined ? {} : { profile: canonicalProfile(profile), profile_binding_inspected: false }),
        chains: BRIDGE_CHAINS.map((id) => ({ chain: `eip155:${id}`, token: BRIDGE_USDC[id], decimals: 6, symbol: "USDC" })),
        tools: [{ tool: "across", variant: "Across V4, empty message, no exclusivity", decoder_implemented: true },
            { tool: "stargateV2", variant: "Stargate V2 Taxi, empty compose/options", decoder_implemented: true }],
        route_executable: "requires_current_route_materialization_and_chain_checks",
        profiles: [
            { provider: "local", custody: "local_software", execution_owner: "apn", retry_owner: "apn_observation_only_after_first_send",
                evidence_owner: "configured_chain_rpc", implemented: true, unavailable_reason: null,
                prerequisites: ["existing_local_wallet", "exact_chain_RPCs", "source_USDC_and_native_funding", "foreground_bridge_consent", "zero_or_exact_existing_allowance"] },
            { provider: "metamask-smart-account", custody: "delegated_owner_session", execution_owner: "unavailable", retry_owner: "unavailable",
                evidence_owner: "unavailable", implemented: false, unavailable_reason: "existing_grants_do_not_authorize_LIFI_effects", prerequisites: ["admitted_smart_account_bridge_adapter"] },
            { provider: "metamask-agent-wallet", custody: "provider", execution_owner: "provider", retry_owner: "provider",
                evidence_owner: "provider_and_chain_RPC", implemented: false, unavailable_reason: "bridge_execution_and_recovery_contract_unavailable", prerequisites: ["admitted_provider_bridge_adapter"] },
            { provider: "coinbase-awal", custody: "provider", execution_owner: "provider", retry_owner: "provider",
                evidence_owner: "provider_and_chain_RPC", implemented: false, unavailable_reason: "bridge_execution_and_recovery_contract_unavailable", prerequisites: ["admitted_provider_bridge_adapter"] },
        ],
        rpc_environment: { "eip155:1": "APN_ETHEREUM_RPC_URL", "eip155:8453": "APN_BASE_RPC_URL", "eip155:42161": "APN_ARBITRUM_RPC_URL" },
        inventory_only: [{ tool: "polymer", reason: "protocol_unproved_unique_source_destination_correlation" },
            { tool: "stargateV2-bus", reason: "protocol_unproved_ticket_passenger_GUID_mapping" }, { tool: "all_other_tools", reason: "finite_decoder_and_protocol_proof_unavailable" }],
        fee_control: "USDC_loss_and_native_debit_checked_before_each_first_send; Base_total_native_fee_is_not_an_onchain_cap",
        mainnet_acceptance: { complete: false, passed: 0, required: 3, named_human_acceptance: "open" },
        next_actions: ["apn bridge routes --help"],
    };
}
export function bridgeInventory(responses) {
    const projected = Object.fromEntries(Object.entries(responses).map(([kind, response]) => {
        if (response.status !== 200)
            bridgeFailure("APN_PROVIDER_UNAVAILABLE", `inventory_${kind}_status`);
        const body = bridgeRecord(bridgeJson(response.body, 4 * 1024 * 1024));
        return [kind, { response_hash: sha256(response.body), provider_inventory: inventoryValue(body, 0), executable_capability: false }];
    }));
    return { schema_version: "apn.bridge-inventory.v1", provider: "LI.FI", origin: "https://li.quest/v1", observed: projected,
        capability: bridgeCapabilities(), mainnet_acceptance: "open" };
}
// Inventory is untrusted informational data. Omit URLs, descriptions and unknown fields from public output.
const SAFE_FIELDS = new Set(["chains", "tokens", "bridges", "exchanges", "connections", "pairs", "status", "responseHash", "response", "fromChainId", "toChainId", "fromToken", "toToken", "fromTokens", "toTokens", "id", "key", "name", "symbol", "decimals", "chainId", "chainType", "address"]);
function inventoryValue(value, depth) {
    if (depth > 8)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "inventory_depth");
    if (typeof value === "string")
        return value.length <= 192 && /^[a-zA-Z0-9 ._:/-]*$/u.test(value) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value) ? value : null;
    if (typeof value === "number")
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (value === null || typeof value === "boolean")
        return value;
    if (Array.isArray(value)) {
        if (value.length > 20_000)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "inventory_count");
        return value.map((entry) => inventoryValue(entry, depth + 1));
    }
    const r = bridgeRecord(value);
    return Object.fromEntries(Object.entries(r).filter(([key]) => SAFE_FIELDS.has(key) || /^(?:1|8453|42161)$/u.test(key))
        .map(([key, entry]) => [key, inventoryValue(entry, depth + 1)]));
}
//# sourceMappingURL=catalog.js.map