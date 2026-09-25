import { getAddress } from "viem";
import type { AllowlistInventory, CandidateAsset } from "./allowlist-inventory.js";
import { resolveAllowlistAsset } from "./allowlist-inventory.js";

/** Historical C1-12 direct-transfer identities. This is separate from the sealed market-cap inventory. */
const SUPPLEMENTAL = [
  { chain: "eip155:1", networkName: "Ethereum", symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18,
    source: "docs/lifi.md (Ethereum WETH9 deployment and code hash); docs/evm-direct-live-acceptance-2026-09-19.md (C1-12 mapping)" },
  { chain: "eip155:8453", networkName: "Base", symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18,
    source: "docs/lifi.md (Base WETH9 predeploy and code hash); docs/evm-direct-live-acceptance-2026-09-19.md (C1-12 mapping)" },
  { chain: "eip155:42161", networkName: "Arbitrum One", symbol: "USDT0", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,
    source: "docs/lifi.md (Arbitrum USD₮0 deployment); docs/evm-assets.md (prior direct acceptance)" },
] as const;

export const DIRECT_EVM_SUPPLEMENTAL_ASSETS: readonly CandidateAsset[] = SUPPLEMENTAL.map((entry) => ({
  chain: entry.chain, family: "evm", networkName: entry.networkName, kind: "token", identifier: getAddress(entry.address),
  symbol: entry.symbol, decimals: entry.decimals, selectionClass: null, tokenStandard: "ERC-20", eligibility: null,
  rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false }, caps: null,
  evidence: { source: entry.source }, admission: "not_admitted_owner_configuration_missing",
}));

export function directEvmSupplementalAsset(chain: string, identifier: string | null): CandidateAsset | undefined {
  return DIRECT_EVM_SUPPLEMENTAL_ASSETS.find((row) => row.chain === chain && row.identifier === identifier);
}

/** Only a direct policy admission can resolve a supplemental identity. */
export function resolveDirectPolicyAsset(input: { readonly chain: string; readonly kind: "native" | "token";
  readonly identifier?: string; readonly rail: string }, inventory: AllowlistInventory): CandidateAsset {
  if (input.rail === "direct" && input.kind === "token" && input.identifier !== undefined && input.chain.startsWith("eip155:")) {
    let canonical: string | undefined;
    try { canonical = getAddress(input.identifier); } catch { /* The frozen resolver classifies invalid identities. */ }
    if (canonical === input.identifier) {
      const row = directEvmSupplementalAsset(input.chain, canonical);
      if (row !== undefined) return row;
    }
  }
  return resolveAllowlistAsset(input, inventory);
}
