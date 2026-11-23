import { MM_DEPLOYMENTS, MM_RPC_ENV, mmChainTokens, mmTokenSymbol } from "./registry.js";

/**
 * Pure catalog data; never hydrate a wallet or infer live provider availability. One entry per registry row: chain 56
 * lists its USDT and its USDC, each naming the `--asset` its commands need.
 */
export function metaMaskGaslessNetworks() {
  return MM_DEPLOYMENTS.map(({ row, deploymentEvidenceHash }) => ({ chain_id: row.chainId, name: row.network, token: row.token,
    symbol: mmTokenSymbol(row.token), decimals: row.decimals, rpc_environment: MM_RPC_ENV[row.chainId], finality_tag: row.finalityTag,
    deployment_evidence_hash: deploymentEvidenceHash, ...(mmChainTokens(row.chainId).length > 1 ? { asset_required: true } : {}),
    executable_adapter: true, action_time_verification_required: true, mainnet_acceptance: "open" }));
}
