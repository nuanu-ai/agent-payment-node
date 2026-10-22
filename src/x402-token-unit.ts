import { loadAllowlistInventory } from "./allowlist-inventory.js";
import { releasedX402Pair } from "./x402-network.js";

/**
 * What an owner reads beside an x402 policy's token address: the released USDC of Base, Ethereum or Arbitrum, or the
 * symbol and decimals APN's frozen token list names for that exact chain and contract; null when the list has no row.
 */
export function x402TokenUnit(chainId: number, token: string): { readonly symbol: string; readonly decimals: number } | null {
  if (releasedX402Pair(chainId, token)) return { symbol: "USDC", decimals: 6 };
  const listed = loadAllowlistInventory().assets.find((row) => row.chain === `eip155:${chainId}` &&
    row.identifier?.toLowerCase() === token.toLowerCase());
  return listed === undefined ? null : { symbol: listed.symbol, decimals: listed.decimals };
}

/** How an error names an x402 asset: "MXNB (0xF197…, 6 decimals) on eip155:8453", or the bare address the list does not name. */
export function x402AssetLabel(chainId: number, token: string): string {
  const unit = x402TokenUnit(chainId, token);
  return `${unit === null ? token : `${unit.symbol} (${token}, ${unit.decimals} decimals)`} on eip155:${chainId}`;
}
