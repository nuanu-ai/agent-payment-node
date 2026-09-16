import { sha256 } from "../canonical.js";
import { canonicalProfile } from "../wallet-policy.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_CHAINS } from "./asset-registry.js";
import { BASE_SOLANA_USDC_CANDIDATE, BASE_TRON_USDT_CANDIDATE } from "./discovery-candidates.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY, bridgeFailure, bridgeJson, bridgeRecord } from "./validation.js";
export function bridgeCapabilities(profile) {
    return { schema_version: "apn.bridge-capabilities.v1", ...(profile === undefined ? {} : { profile: canonicalProfile(profile), profile_binding_inspected: false }),
        chains: BRIDGE_CHAINS.map((id) => {
            const row = BRIDGE_ASSET_REGISTRY[id];
            return { chain: row.caip2, name: row.name,
                native_coin: { symbol: row.nativeCoin.symbol, coin_key: row.nativeCoin.coinKey, decimals: row.nativeCoin.decimals,
                    bridgeable_principal: false, role: "gas_and_messaging_fee_only" },
                tokens: row.tokens.map((asset) => ({ token: asset.address, symbol: asset.symbol, coin_key: asset.coinKey,
                    decimals: asset.decimals, upgradeability: asset.code.upgradeability,
                    tools: asset.stargate === null ? ["across"] : ["across", "stargateV2"],
                    peers: asset.peers.map((peer) => BRIDGE_ASSET_REGISTRY[peer].caip2) })) };
        }),
        tools: [{ tool: "across", variant: "Across V4, empty message, no exclusivity", decoder_implemented: true },
            { tool: "stargateV2", variant: "Stargate V2 Taxi, empty compose/options", decoder_implemented: true }],
        candidate_lanes: [{ from_chain: "eip155:8453", from_token: BASE_SOLANA_USDC_CANDIDATE.fromToken,
                to_lifi_chain_id: BASE_SOLANA_USDC_CANDIDATE.toChainId, to_token: BASE_SOLANA_USDC_CANDIDATE.toToken,
                provider_route_state: BASE_SOLANA_USDC_CANDIDATE.providerRouteState, executable: BASE_SOLANA_USDC_CANDIDATE.executable,
                missing_proof: ["selected_route_and_source_call", "solana_destination_delivery_and_finality", "fee_and_recovery_contract"] },
            { from_chain: "eip155:8453", from_token: BASE_TRON_USDT_CANDIDATE.fromToken,
                to_lifi_chain_id: BASE_TRON_USDT_CANDIDATE.toChainId, to_token: BASE_TRON_USDT_CANDIDATE.toToken,
                tool: BASE_TRON_USDT_CANDIDATE.tool, provider_route_state: BASE_TRON_USDT_CANDIDATE.providerRouteState,
                executable: BASE_TRON_USDT_CANDIDATE.executable,
                missing_proof: ["selected_allbridge_route_and_source_call", "tron_solidified_destination_delivery_and_correlation", "fee_refund_and_recovery_contract"] }],
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
        rpc_environment: Object.fromEntries(BRIDGE_CHAINS.map((id) => [BRIDGE_ASSET_REGISTRY[id].caip2, BRIDGE_ASSET_REGISTRY[id].rpcEnvironment])),
        inventory_only: [{ tool: "polymer", reason: "protocol_unproved_unique_source_destination_correlation" },
            { asset: "native_principal", reason: "fee_forwarder_allowance_and_Transfer_log_evidence_are_ERC20_shaped" },
            { asset: "fee_on_transfer_or_rebasing_token", reason: "exact_three_Transfer_log_proof_cannot_hold" },
            { asset: "stargate_pool_asset_other_than_1", reason: "pool_not_reviewed_the_way_USDC_was" },
            { tool: "stargateV2-bus", reason: "protocol_unproved_ticket_passenger_GUID_mapping" }, { tool: "all_other_tools", reason: "finite_decoder_and_protocol_proof_unavailable" }],
        fee_control: "token_loss_and_native_debit_checked_before_each_first_send; Base_total_native_fee_is_not_an_onchain_cap",
        fee_headroom: { policy: BRIDGE_FEE_HEADROOM_POLICY, headroom_bps: BRIDGE_FEE_HEADROOM_BPS,
            statement: "The approved maximum is the preparation quote raised by this headroom; a fresh estimate above it is refused, never repriced." },
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
/** Validate a candidate response at its actual depth inside connections.pairs[].response. */
export function validateBridgeInventoryCandidate(response) { inventoryValue(response, 3); }
// Inventory is untrusted informational data. Omit URLs, descriptions and unknown fields from public output.
const SAFE_FIELDS = new Set(["chains", "tokens", "bridges", "exchanges", "connections", "pairs", "status", "responseHash", "response", "fromChainId", "toChainId", "fromToken", "toToken", "fromTokens", "toTokens", "id", "key", "name", "symbol", "decimals", "chainId", "chainType", "address", "tool"]);
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
    const admitted = new Set(BRIDGE_CHAINS.map(String));
    return Object.fromEntries(Object.entries(r).filter(([key]) => SAFE_FIELDS.has(key) || admitted.has(key))
        .map(([key, entry]) => [key, inventoryValue(entry, depth + 1)]));
}
//# sourceMappingURL=catalog.js.map