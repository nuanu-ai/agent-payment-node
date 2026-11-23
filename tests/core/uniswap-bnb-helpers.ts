import { encodeAbiParameters, encodeFunctionResult, keccak256, parseAbi, parseTransaction, type Hex } from "viem";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import type { AssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import type { SwapAdmissionMechanism } from "../../src/swap/route-admission.js";
import { BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_WBNB_500,
  BNB_UNISWAP_V3_FACTORY, BNB_USDC, BNB_USDC_IMPLEMENTATION_PIN, BNB_USDT, BNB_WBNB } from "../../src/swap/uniswap-bnb/pins.js";
import { ACCOUNT, PROFILE } from "./uniswap-keyless-helpers.js";

/**
 * Pool state, quote and gas read from BNB Smart Chain (blocks 135271904 and 135273443, 2026-11-23): USDT/WBNB 500 slot0,
 * QuoterV2 output for 0.01 BNB, and the SwapRouter02 gas estimate of that exact call.
 */
export const BNB_SQRT_PRICE_X96 = 3359284990240615483719373868n, BNB_USDC_SQRT_PRICE_X96 = 3362080327301153853475293657n;
export const BNB_AMOUNT_IN = "10000000000000000", BNB_QUOTED_OUT = 5559204179861381185n, BNB_GAS_ESTIMATE = 155_255n;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
export const DEPOSIT_TOPIC = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c" as const;
const POOL = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);
const QUOTER = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
export const topic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
export const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
export const quantity = (value: bigint): Hex => `0x${value.toString(16)}`;

/** Deterministic chain-56 reader. Effects are counted; nothing leaves the process. */
export class BnbRpc {
  head = 1000n; balance = 10n ** 18n; nonce = 3n; pendingNonce = 3n; quoted = BNB_QUOTED_OUT; chainId = "0x38"; decimals = 18n;
  pool = BNB_UNISWAP_USDT_WBNB_500 as string; routerReverts = false; sends: Hex[] = []; receipt: "none" | "success" | "revert" = "none";
  minedAt = 0n; credit = BNB_QUOTED_OUT; gasUsed = 120_000n; gasPrice = 100_000_000n; calls: string[] = [];
  /** The USDC proxy implementation slot answer; deployed code is never the pinned bytes, so a real code pin check refuses. */
  implementation: string = BNB_USDC_IMPLEMENTATION_PIN.address;
  readonly call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    this.calls.push(method);
    if (method === "eth_chainId") return this.chainId;
    if (method === "eth_getBlockByNumber") return this.block(params[0] as string);
    if (method === "eth_getBalance") return quantity(this.minedAt !== 0n && params[1] === quantity(this.minedAt) ? this.balance - this.spent() : this.balance);
    if (method === "eth_estimateGas") { if (this.routerReverts) throw new Error("revert"); return quantity(BNB_GAS_ESTIMATE); }
    if (method === "eth_getTransactionCount") return quantity(params[1] === "pending" ? this.pendingNonce : this.nonce);
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; this.sends.push(raw); return keccak256(raw); }
    if (method === "eth_call") return this.ethCall(params[0] as { to: string; data: Hex }, params[1] as string);
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_getStorageAt") return topic(this.implementation);
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") return this.mined(method, params[0] as Hex);
    throw new Error(`unexpected ${method}`);
  };
  private spent(): bigint { return this.receipt === "success" ? BigInt(BNB_AMOUNT_IN) + this.gasUsed * this.gasPrice : this.gasUsed * this.gasPrice; }
  private block(tag: string): unknown {
    const number = tag === "latest" || tag === "safe" || tag === "finalized" ? this.head : BigInt(tag);
    return { number: quantity(number), hash: `0x${number.toString(16).padStart(64, "0")}`, baseFeePerGas: "0x0", timestamp: quantity(1_795_437_312n) };
  }
  private ethCall(tx: { to: string; data: Hex }, tag: string): Hex {
    if ((tx.to === BNB_UNISWAP_USDT_WBNB_500 || tx.to === BNB_UNISWAP_USDC_WBNB_500) && tx.data.startsWith("0x3850c7bd")) {
      return encodeFunctionResult({ abi: POOL, functionName: "slot0", result: [tx.to === BNB_UNISWAP_USDT_WBNB_500 ? BNB_SQRT_PRICE_X96 :
        BNB_USDC_SQRT_PRICE_X96, -63_215, 1, 2, 2, 0, true] });
    }
    if (tx.to === BNB_UNISWAP_USDT_WBNB_500 || tx.to === BNB_UNISWAP_USDC_WBNB_500) {
      return encodeFunctionResult({ abi: POOL, functionName: "liquidity", result: 920_928_687_969_966_626_015_888n });
    }
    if (tx.to === BNB_UNISWAP_QUOTER_V2) {
      return encodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", result: [this.quoted, BNB_SQRT_PRICE_X96 + 1n, 1, 79_465n] });
    }
    if (tx.to === BNB_UNISWAP_SWAP_ROUTER_02) { if (this.routerReverts) throw new Error("revert"); return "0x"; }
    if ((tx.to === BNB_USDT || tx.to === BNB_USDC) && tx.data === "0x313ce567") return word(this.decimals);
    if ((tx.to === BNB_USDT || tx.to === BNB_USDC) && tx.data.startsWith("0x70a08231")) return word(this.minedAt !== 0n && tag === quantity(this.minedAt) ? this.credit : 0n);
    if (tx.to === BNB_UNISWAP_V3_FACTORY) {
      return encodeAbiParameters([{ type: "address" }], [tx.data.includes(BNB_USDT.slice(2).toLowerCase()) ? this.pool as Hex : BNB_UNISWAP_USDC_WBNB_500]);
    }
    throw new Error(`unexpected call ${tx.to}`);
  }
  /** The mined transaction and receipt of the one raw transaction sent, built from its own signed fields. */
  private mined(method: string, hash: Hex): unknown {
    const raw = this.sends[0];
    if (this.receipt === "none" || raw === undefined || keccak256(raw) !== hash) return null;
    const tx = parseTransaction(raw), blockNumber = quantity(this.minedAt), blockHash = `0x${this.minedAt.toString(16).padStart(64, "0")}`;
    const at = { transactionHash: hash, blockNumber, blockHash, removed: false };
    const logs = this.receipt === "success" ? [
      { address: BNB_WBNB, topics: [DEPOSIT_TOPIC, topic(BNB_UNISWAP_SWAP_ROUTER_02)], data: word(BigInt(BNB_AMOUNT_IN)), ...at },
      { address: BNB_USDT, topics: [TRANSFER_TOPIC, topic(this.pool), topic(ACCOUNT)], data: word(this.credit), ...at },
    ] : [];
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, from: ACCOUNT, to: BNB_UNISWAP_SWAP_ROUTER_02,
      status: this.receipt === "success" ? "0x1" : "0x0", logs, gasUsed: quantity(this.gasUsed), effectiveGasPrice: quantity(this.gasPrice), blockNumber, blockHash };
    return { hash, from: ACCOUNT, to: BNB_UNISWAP_SWAP_ROUTER_02, chainId: quantity(BigInt(tx.chainId!)), nonce: quantity(BigInt(tx.nonce!)),
      gas: quantity(tx.gas!), type: "0x2", maxFeePerGas: quantity(tx.maxFeePerGas!), maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas!),
      input: tx.data, value: quantity(tx.value!), blockNumber, blockHash };
  }
}

/** Native BNB and Binance-Peg USDT admitted for the swap rail with one exact mechanism or route. */
export function bnbPolicy(now: Date, deadline: Date, mechanism: SwapAdmissionMechanism): AssetPolicyRegistry {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "uniswap-bnb.1", profile: PROFILE, account: ACCOUNT,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(deadline.getTime() + 3_600_000).toISOString(), admissions: [
      { chain: "eip155:56", kind: "native", rail: "swap", maximumPerTransferAtomic: BNB_AMOUNT_IN, dailyLimitAtomic: BNB_AMOUNT_IN, mechanism },
      { chain: "eip155:56", kind: "token", identifier: BNB_USDT, rail: "swap", maximumPerTransferAtomic: "10000000000000000000",
        dailyLimitAtomic: "10000000000000000000", mechanism },
    ] };
  return compileAllowlistPolicyOverlay(overlay).registry;
}
