import { getAddress } from "viem";
import { sha256 } from "./canonical.js";
// Exact approved finite policy snapshots. Only the sole wallet owner value is bound to a connected profile.
const LEGACY_PAYER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const BASE_POLICY = "# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
const OP_POLICY = "# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 10\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
/** Pure policy identities, never an owner certificate, scope issuer or public financial callback. */
export function metaMaskNativePolicyVariants(payer) {
    const address = getAddress(payer).toLowerCase();
    return [BASE_POLICY, OP_POLICY].map((template, index) => {
        const policy = template.replace(`wallet_address: "${LEGACY_PAYER}"`, `wallet_address: "${address}"`);
        return Object.freeze({ vendorPolicyHash: sha256(policy), policyBytes: Buffer.byteLength(policy, "utf8"), allowsOptimism: index === 1 });
    });
}
export function metaMaskNativePolicyAllowsChain(policy, chainId, payer) {
    return [1, 10, 143, 59144, 1329].includes(chainId) && metaMaskNativePolicyVariants(payer).some(v => v.vendorPolicyHash === policy.vendorPolicyHash && v.policyBytes === policy.policyBytes && (chainId !== 10 || v.allowsOptimism));
}
//# sourceMappingURL=metamask-native-policy.js.map