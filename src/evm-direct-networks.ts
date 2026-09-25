import { loadAllowlistInventory, type CandidateAsset } from "./allowlist-inventory.js";
import { ApnError } from "./errors.js";
import { DIRECT_EVM_SUPPLEMENTAL_ASSETS } from "./evm-direct-supplemental-assets.js";

/**
 * How a network charges a direct transfer, beyond `gas limit x max fee per gas`:
 * - `eip1559`: execution only; the charge is gas used x effective price, so the budget is an upper bound.
 * - `op-stack`: execution plus the L1 data fee and operator fee read from the GasPriceOracle predeploy.
 * - `arbitrum-inclusive`: the L1 posting cost is folded into L2 gas; no separate surcharge and no priority fee.
 * - `monad-gas-limit`: Monad bills the full gas limit, not gas used, so the charge is the budgeted limit x effective price.
 */
export type DirectEvmFeeModel = "eip1559" | "op-stack" | "arbitrum-inclusive" | "monad-gas-limit";

/**
 * When a successful receipt completes a transfer:
 * - `inclusion`: a canonical receipt at the selected RPC's latest head.
 * - `safe`: the receipt block must also be at or below the selected RPC's `safe` head.
 */
export type DirectEvmFinality = "inclusion" | "safe";

export interface DirectEvmNetwork {
  readonly chainId: number;
  readonly caip2: string;
  readonly name: string;
  readonly nativeSymbol: string;
  readonly nativeDecimals: 18;
  readonly feeModel: DirectEvmFeeModel;
  readonly finality: DirectEvmFinality;
}

const network = <const C extends number>(chainId: C, name: string, nativeSymbol: string, feeModel: DirectEvmFeeModel,
  finality: DirectEvmFinality) => ({ chainId, caip2: `eip155:${chainId}` as const, name, nativeSymbol, nativeDecimals: 18 as const, feeModel, finality });

/**
 * The networks on which a local wallet may prepare a direct native or list-token transfer. It is deliberately separate
 * from `EVM_NETWORKS`, which x402, LI.FI, wallet policy and portfolio share: widening that list would enable those
 * rails too. Fee and finality behaviour was checked read-only against each mainnet on 2026-09-18 (docs/evm-assets.md).
 */
export const DIRECT_EVM_NETWORKS = [
  network(1, "Ethereum", "ETH", "eip1559", "inclusion"),
  network(8453, "Base", "ETH", "op-stack", "inclusion"),
  network(42161, "Arbitrum One", "ETH", "arbitrum-inclusive", "safe"),
  network(10, "OP Mainnet", "ETH", "op-stack", "inclusion"),
  network(137, "Polygon PoS", "POL", "eip1559", "inclusion"),
  network(56, "BNB Smart Chain", "BNB", "eip1559", "safe"),
  network(43114, "Avalanche C-Chain", "AVAX", "eip1559", "safe"),
  network(130, "Unichain", "ETH", "op-stack", "inclusion"),
  network(59144, "Linea", "ETH", "eip1559", "inclusion"),
  network(143, "Monad", "MON", "monad-gas-limit", "safe"),
  network(1329, "Sei EVM", "SEI", "eip1559", "safe"),
] as const satisfies readonly DirectEvmNetwork[];

export type DirectEvmNetworkRow = typeof DIRECT_EVM_NETWORKS[number];
export type DirectEvmChainId = DirectEvmNetworkRow["chainId"];

/** Fee models whose meaning a persisted quote must name; the rest keep the quote shape frozen before this registry. */
export type DirectEvmQuoteFeeModel = "arbitrum-inclusive" | "monad-gas-limit";

export function directEvmChain(value: unknown): DirectEvmChainId {
  const selected = DIRECT_EVM_NETWORKS.find((entry) => value === entry.chainId || value === entry.caip2);
  if (selected === undefined) throw new ApnError("APN_INVALID_INPUT", "Select a direct-transfer EVM mainnet by its exact CAIP-2 identity.");
  return selected.chainId;
}

export function directEvmNetwork(chainId: DirectEvmChainId): DirectEvmNetworkRow {
  const selected = DIRECT_EVM_NETWORKS.find((entry) => entry.chainId === chainId);
  if (selected === undefined) throw new ApnError("APN_INVALID_INPUT", "The EVM network is not enabled for direct transfers.");
  return selected;
}

export function directEvmNetworkByCaip2(chain: string): DirectEvmNetworkRow | undefined {
  return DIRECT_EVM_NETWORKS.find((entry) => entry.caip2 === chain);
}

export function directEvmQuoteFeeModel(chainId: DirectEvmChainId): DirectEvmQuoteFeeModel | undefined {
  const model = directEvmNetwork(chainId).feeModel;
  return model === "arbitrum-inclusive" || model === "monad-gas-limit" ? model : undefined;
}

export function directEvmRequiresSafeHead(chainId: DirectEvmChainId): boolean {
  return directEvmNetwork(chainId).finality === "safe";
}

/**
 * Direct rows of one network: frozen native/token identities plus the three C1-12 direct-only token deployments.
 * The registry's native coin must agree with the frozen row, so a list revision cannot silently rename or re-scale it.
 */
export function directEvmListRows(chainId: DirectEvmChainId): readonly CandidateAsset[] {
  const selected = directEvmNetwork(chainId);
  const rows = loadAllowlistInventory().assets.filter((row) => row.chain === selected.caip2);
  const native = rows.filter((row) => row.kind === "native");
  if (native.length !== 1 || native[0]?.symbol !== selected.nativeSymbol || native[0].decimals !== selected.nativeDecimals ||
      rows.some((row) => row.family !== "evm")) {
    throw new ApnError("APN_STATE_CORRUPT", "The direct EVM network registry disagrees with the frozen allowlist.", { chain: selected.caip2 });
  }
  return [...rows, ...DIRECT_EVM_SUPPLEMENTAL_ASSETS.filter((row) => row.chain === selected.caip2)];
}
