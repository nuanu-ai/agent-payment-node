import { encodeFunctionResult, keccak256, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { sealAssetPolicyRegistry, type AssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { hashObject } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { UNISWAP_ROUTER, UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_QUOTER_V2, UNISWAP_V3_USDC_WETH_500 } from "../../src/swap/uniswap-v3/pins.js";

export const KEY = `0x${"0".repeat(63)}1` as const;
export const ACCOUNT = privateKeyToAccount(KEY).address;
export const PROFILE = "uniswap-keyless";
export const SQRT_PRICE_X96 = 1594054304753181319742465080701116n;
export const AMOUNT_IN = "1000000000000000", QUOTED_OUT = 2469083n;
export const H = (c: string) => c.repeat(64);
const POOL = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);
const QUOTER = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export class MemoryWrapping implements WrappingSecretPort {
  readonly value = Buffer.alloc(32, 7);
  async load() { return Buffer.from(this.value); }
  async create() { return Buffer.from(this.value); }
}

/** Deterministic mainnet-shaped reader. Effects are counted; nothing leaves the process. */
export class KeylessRpc {
  head = 100n; baseFee = 1_000_000_000n; balance = 10n ** 18n; nonce = 7n; pendingNonce = 7n; quoted = QUOTED_OUT;
  routerReverts = false; chainId = "0x1"; sends: Hex[] = []; receipt: "none" | "success" | "revert" = "none"; minedAt = 0n;
  calls: string[] = [];
  readonly call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    this.calls.push(method);
    if (method === "eth_chainId") return this.chainId;
    if (method === "eth_getBlockByNumber") return this.block(params[0] as string);
    if (method === "eth_getBalance") return quantity(this.balance);
    if (method === "eth_estimateGas") { if (this.routerReverts) throw new Error("revert"); return quantity(162_467n); }
    if (method === "eth_getTransactionCount") return quantity(params[1] === "pending" ? this.pendingNonce : this.nonce);
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; this.sends.push(raw); return keccak256(raw); }
    if (method === "eth_call") return this.ethCall(params[0] as { to: string; data: Hex });
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") return this.mined(method, params[0] as Hex);
    throw new Error(`unexpected ${method}`);
  };
  private block(tag: string): unknown {
    const number = tag === "latest" ? this.head : tag === "safe" || tag === "finalized" ? this.head : BigInt(tag);
    return { number: quantity(number), hash: `0x${number.toString(16).padStart(64, "0")}`, baseFeePerGas: quantity(this.baseFee) };
  }
  private ethCall(tx: { to: string; data: Hex }): Hex {
    if (tx.to === UNISWAP_V3_USDC_WETH_500 && tx.data.startsWith("0x3850c7bd")) {
      return encodeFunctionResult({ abi: POOL, functionName: "slot0", result: [SQRT_PRICE_X96, 198186, 1, 2, 2, 0, true] });
    }
    if (tx.to === UNISWAP_V3_USDC_WETH_500) return encodeFunctionResult({ abi: POOL, functionName: "liquidity", result: 4_492_850_338_529_522_898n });
    if (tx.to === UNISWAP_V3_QUOTER_V2) {
      return encodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", result: [this.quoted, SQRT_PRICE_X96 + 1n, 1, 90_039n] });
    }
    if (tx.to === UNISWAP_ROUTER) { if (this.routerReverts) throw new Error("revert"); return "0x"; }
    throw new Error(`unexpected call ${tx.to}`);
  }
  private mined(method: string, hash: Hex): unknown {
    const raw = this.sends[0];
    if (this.receipt === "none" || raw === undefined || keccak256(raw) !== hash) return null;
    const block = { blockNumber: quantity(this.minedAt), blockHash: `0x${this.minedAt.toString(16).padStart(64, "0")}` };
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, from: ACCOUNT, to: UNISWAP_ROUTER,
      status: this.receipt === "success" ? "0x1" : "0x0", logs: [], ...block };
    return { hash, from: ACCOUNT, to: UNISWAP_ROUTER, chainId: "0x1", nonce: quantity(this.nonce), gas: this.gas,
      type: "0x2", maxFeePerGas: this.maxFee, maxPriorityFeePerGas: this.priority, input: "0x", value: "0x0", ...block };
  }
  gas = "0x0"; maxFee = "0x0"; priority = "0x0";
}

export function quantity(value: bigint): Hex { return `0x${value.toString(16)}`; }

export async function keylessPolicy(now: Date, deadline: Date, caps = { native: AMOUNT_IN, usdc: "10000000" }): Promise<AssetPolicyRegistry> {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "uniswap-keyless.1", profile: PROFILE,
    account: ACCOUNT, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(deadline.getTime() + 3_600_000).toISOString(), admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: caps.native, dailyLimitAtomic: caps.native, mechanism: UNISWAP_V3_KEYLESS_MECHANISM_PIN },
      { chain: "eip155:1", kind: "token", identifier: UNISWAP_USDC, rail: "swap", maximumPerTransferAtomic: caps.usdc, dailyLimitAtomic: caps.usdc,
        mechanism: UNISWAP_V3_KEYLESS_MECHANISM_PIN },
    ] };
  const compiled = compileAllowlistPolicyOverlay(overlay).registry;
  return sealAssetPolicyRegistry({ schemaVersion: compiled.schemaVersion, registryVersion: compiled.registryVersion,
    publishedAt: compiled.publishedAt, effectiveDate: compiled.effectiveDate,
    ...(compiled.effectiveAt === undefined ? {} : { effectiveAt: compiled.effectiveAt }),
    ...(compiled.expiresAt === undefined ? {} : { expiresAt: compiled.expiresAt }),
    chains: compiled.chains.map((chain) => ({ ...chain, assets: chain.assets.map((asset) => ({ ...asset, rails: { ...asset.rails, direct: true } })) })) });
}

/** Local non-custodial wallet for the profile: encrypted key plus the public wallet record the owner check reads. */
export async function keylessWallet(root: string, wrapping: MemoryWrapping, createdAt: Date): Promise<StateStore> {
  const state = new StateStore(root); await state.initialize();
  const identity = { profile: PROFILE, address: ACCOUNT, chainId: 8453 as const, createdAt: createdAt.toISOString(),
    bindingHash: hashObject({ profile: PROFILE, address: ACCOUNT, createdAt: createdAt.toISOString() }) };
  await new EncryptedWalletStore(state, wrapping).save(identity, { version: "apn.wallet-secret.v1", privateKey: KEY, directEffects: {}, x402Effects: {} },
    Buffer.from(wrapping.value));
  await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile: PROFILE, profileHash: state.profileHash(PROFILE),
    address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash }));
  return state;
}
