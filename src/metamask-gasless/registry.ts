import { hashObject } from "../canonical.js";
import { MM_DEPLOYMENTS, MM_DEPLOYMENT_SOURCE_FILES } from "./registry-data.js";
import { MM_CHAINS, type MetaMaskGaslessChainId, type MetaMaskGaslessDeployment } from "./model.js";
import { mmFail } from "./reasons.js";

export { MM_CHAINS } from "./model.js";
export const MM_DEPLOYMENT_INPUT_SHA = "136babcbb5f856292e1519d19a8ee78070ec06188fe3f7f245fe59c38b14ad38";
export const MM_RPC_ENV: Readonly<Record<MetaMaskGaslessChainId, string>> = Object.freeze({
  1: "APN_ETHEREUM_RPC_URL", 10: "APN_OPTIMISM_RPC_URL", 137: "APN_POLYGON_RPC_URL",
  143: "APN_MONAD_RPC_URL", 1329: "APN_SEI_RPC_URL", 8453: "APN_BASE_RPC_URL",
  42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL",
});
export const MM_SENTINEL_SLUG: Readonly<Record<MetaMaskGaslessChainId, string>> = Object.freeze({
  1: "ethereum-mainnet", 10: "optimism-mainnet", 137: "polygon-mainnet", 143: "monad-mainnet",
  1329: "sei-mainnet", 8453: "base-mainnet", 42161: "arbitrum-mainnet", 59144: "linea-mainnet",
});
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
if (MM_DEPLOYMENTS.length !== MM_CHAINS.length || MM_DEPLOYMENTS.some((entry, index) =>
  entry.row.chainId !== MM_CHAINS[index] || entry.deploymentEvidenceHash !== hashObject({
    purpose: "apn.metamask-gasless.deployment-evidence.v1", sourceFiles: MM_DEPLOYMENT_SOURCE_FILES, row: entry.row,
  }))) mmFail("mm_gasless_state_corrupt");
freeze(MM_DEPLOYMENT_SOURCE_FILES); freeze(MM_DEPLOYMENTS);
/** Static source-correlated input, never current account or mainnet payment acceptance. */
export function mmRegistry(chainId: number): MetaMaskGaslessDeployment {
  const entry = MM_DEPLOYMENTS.find(row => row.row.chainId === chainId);
  if (!entry) mmFail("mm_gasless_unsupported_chain");
  return entry;
}
