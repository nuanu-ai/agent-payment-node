import { getAddress } from "viem";
import type { CandidateAsset } from "../allowlist-inventory.js";
import { canonicalJson } from "../canonical.js";
export const MERCHANT_URL = "https://x402engine.app/api/crypto/price?ids=bitcoin";
export const MERCHANT_RPC = "https://mainnet.megaeth.com/rpc";
export const MERCHANT_CHAIN = "eip155:4326";
export const MERCHANT_OWNER = getAddress("0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14");
export const MERCHANT_TOKEN = getAddress("0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7");
export const MERCHANT_PAYEE = getAddress("0x7dd5Be069f2d2eAd75eC7C3423B116fF043c2629");
export const MERCHANT_AMOUNT = "1000000000000000";
export const MERCHANT_PROXY_HASH = "0xfdf85d183a122fe611bc878683b722b2b22633e13900c4b13767742b9f5f5a90";
export const MERCHANT_IMPLEMENTATION = getAddress("0xAC37677261885fDB372A37Ac8D5d47044196073C");
export const MERCHANT_IMPLEMENTATION_HASH = "0x781c9c39ab69e9b7d099ec75e5a28df41dc891c8fffbe0148c94ed5adc8b0c09";
export const MERCHANT_MECHANISM = { provider: "x402engine-erc20-transfer-proof", reference: "megaeth-usdm-crypto-price-v1" } as const;
export const MERCHANT_NATIVE_POLICY_ASSET: CandidateAsset = { chain: MERCHANT_CHAIN, family: "evm", networkName: "MegaETH", kind: "native", identifier: null, symbol: "ETH", decimals: 18, selectionClass:null, tokenStandard:null, eligibility:null, rails:{direct:false,gasless:false,x402:false,bridge:false,swap:false}, caps:null, evidence:{source:"docs/x402-merchant-usdm.md"}, admission:"not_admitted_owner_configuration_missing" };
export const MERCHANT_POLICY_ASSET: CandidateAsset = { chain: MERCHANT_CHAIN, family: "evm", networkName: "MegaETH", kind: "token", identifier: MERCHANT_TOKEN,
    symbol: "USDm", decimals: 18, selectionClass: null, tokenStandard: "ERC-20", eligibility: null,
    rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false }, caps: null,
    evidence: { source: "docs/x402-merchant-usdm.md" }, admission: "not_admitted_owner_configuration_missing" };
/** This supplement grants no admission and cannot widen the generic x402 mechanism registry. */
export function merchantPolicyAsset(input: {
    chain: string;
    kind: string;
    identifier?: string;
    rail: string;
    mechanism?: unknown;
    mechanisms?: unknown;
}): CandidateAsset | undefined {
    return input.chain === MERCHANT_CHAIN && (input.kind === "token" && input.identifier === MERCHANT_TOKEN || input.kind === "native" && input.identifier === undefined) && input.rail === "x402" &&
        input.mechanisms === undefined && canonicalJson(input.mechanism ?? null) === canonicalJson(MERCHANT_MECHANISM) ? input.kind === "native" ? MERCHANT_NATIVE_POLICY_ASSET : MERCHANT_POLICY_ASSET : undefined;
}
