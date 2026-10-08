import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  getChecksumAddress,
  isHexChecksumAddress,
  isStrictHexString
} from "./chunk-T6VOGCFD.mjs";
import "./chunk-ZSEVIWSW.mjs";
import "./chunk-VBXYOQOU.mjs";
import "./chunk-GQCBBNZL.mjs";

// node_modules/@x402/evm/dist/esm/chunk-SGFNIWGK.mjs
var EVM_NETWORK_CHAIN_ID_MAP = {
  ethereum: 1,
  sepolia: 11155111,
  abstract: 2741,
  "abstract-testnet": 11124,
  "base-sepolia": 84532,
  base: 8453,
  "avalanche-fuji": 43113,
  avalanche: 43114,
  iotex: 4689,
  sei: 1329,
  "sei-testnet": 1328,
  polygon: 137,
  "polygon-amoy": 80002,
  peaq: 3338,
  story: 1514,
  educhain: 41923,
  "skale-base-sepolia": 324705682,
  megaeth: 4326,
  monad: 143,
  stable: 988,
  "stable-testnet": 2201,
  celo: 42220,
  flare: 14
};
var NETWORKS = Object.keys(EVM_NETWORK_CHAIN_ID_MAP);

// node_modules/@metamask/x402/dist/index.mjs
function getAddress(value) {
  if (!isHexChecksumAddress(value)) {
    throw new Error("Invalid Ethereum address");
  }
  const lowerAddress = value.toLowerCase();
  const upperAddress = `0x${value.slice(2).toUpperCase()}`;
  const checksummedAddress = getChecksumAddress(value);
  if (value !== lowerAddress && value !== upperAddress && value !== checksummedAddress) {
    throw new Error("Invalid Ethereum address checksum");
  }
  return checksummedAddress;
}
function normalizeDelegationPayload(payload) {
  if (!isStrictHexString(payload.permissionContext)) {
    throw new Error(
      "Invalid delegation payload: permissionContext must be non-empty hex data"
    );
  }
  return {
    delegationManager: getAddress(payload.delegationManager),
    permissionContext: payload.permissionContext,
    delegator: getAddress(payload.delegator)
  };
}
var x402Erc7710Client = class {
  scheme = "exact";
  #delegationProvider;
  #fallbackClient;
  constructor(config) {
    this.#delegationProvider = config.delegationProvider;
    this.#fallbackClient = config.fallbackClient;
  }
  async createPaymentPayload(x402Version, paymentRequirements, context) {
    const assetTransferMethod = paymentRequirements.extra?.assetTransferMethod;
    if (assetTransferMethod !== "erc7710") {
      if (this.#fallbackClient) {
        return this.#fallbackClient.createPaymentPayload(
          x402Version,
          paymentRequirements,
          context
        );
      }
      const invalidAssetTransferMethod = typeof assetTransferMethod === "string" ? `"${assetTransferMethod}"` : JSON.stringify(assetTransferMethod);
      throw new Error(
        `x402Erc7710Client can only process assetTransferMethod "erc7710". Received: ${invalidAssetTransferMethod}`
      );
    }
    const delegation = await this.#delegationProvider(paymentRequirements);
    return {
      x402Version,
      payload: normalizeDelegationPayload(delegation)
    };
  }
};
export {
  x402Erc7710Client
};
