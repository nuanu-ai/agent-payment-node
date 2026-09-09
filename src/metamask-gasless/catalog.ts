import { MM_CHAINS, MM_RPC_ENV, mmRegistry } from "./registry.js";

/** Pure catalog data; never hydrate a wallet or infer live provider availability. */
export function metaMaskGaslessNetworks() {
  return MM_CHAINS.map(chainId => {
    const { row, deploymentEvidenceHash } = mmRegistry(chainId);
    return { chain_id: chainId, name: row.network, token: row.token, symbol: "USDC", decimals: 6,
      rpc_environment: MM_RPC_ENV[chainId], finality_tag: row.finalityTag, deployment_evidence_hash: deploymentEvidenceHash,
      executable_adapter: true, action_time_verification_required: true, mainnet_acceptance: "open" };
  });
}
