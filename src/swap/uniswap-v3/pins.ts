import { getAddress, keccak256, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex } from "../../evm-rpc-codec.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin, type SwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry, type SwapProtocolRegistry } from "../protocol-registry.js";
import { UNISWAP_ROUTER, UNISWAP_ROUTER_VERSION, UNISWAP_USDC } from "../uniswap-pin.js";

/**
 * Keyless Uniswap V3 pins. Every address and runtime code hash below was read with eth_getCode on Ethereum
 * mainnet (block 26001913, 2026-09-18) and cross-checked: pool.token0/token1/fee/factory, factory.getPool,
 * QuoterV2.factory/WETH9, and a same-block Universal Router simulation whose amountOutMin equals the QuoterV2
 * output (quoted + 1 reverts with V3TooLittleReceived). Contract immutables live in runtime code, so each hash
 * also pins them. The hashes are re-verified at quote time; any drift fails closed.
 */
export const UNISWAP_WETH9 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
export const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as const;
export const UNISWAP_V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as const;
export const UNISWAP_V3_USDC_WETH_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" as const;
/** EIP-1967 style ZeppelinOS implementation slot used by the FiatTokenProxy behind USDC. */
export const USDC_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" as const;

export interface UniswapV3CodePin { readonly role: string; readonly address: string; readonly codeHash: Hex }
export const UNISWAP_V3_CODE_PINS: readonly UniswapV3CodePin[] = [
  { role: "universal_router_2_2_0", address: UNISWAP_ROUTER, codeHash: "0x1b37035dac8ecda2e578a0047748e495aa397ee4bc7640468a5b60c1c55d824c" },
  { role: "quoter_v2", address: UNISWAP_V3_QUOTER_V2, codeHash: "0x06148f47d0f41a68d3bc970030a7150e5d608cfbc28d372440a2e41ce543d92b" },
  { role: "v3_factory", address: UNISWAP_V3_FACTORY, codeHash: "0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69" },
  { role: "weth9", address: UNISWAP_WETH9, codeHash: "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23" },
  { role: "usdc_proxy", address: UNISWAP_USDC, codeHash: "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505" },
  { role: "pool_usdc_weth_500", address: UNISWAP_V3_USDC_WETH_500, codeHash: "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4" },
];
export const USDC_IMPLEMENTATION_PIN: UniswapV3CodePin = { role: "usdc_implementation",
  address: "0x43506849D7C04F9138D1A2050bbF3A0c054402dd", codeHash: "0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea" };

export interface UniswapV3PairPin {
  readonly outputToken: string;
  readonly outputSymbol: string;
  readonly outputDecimals: number;
  readonly pool: string;
  /** Uniswap fee in hundredths of a basis point. */
  readonly fee: number;
  /** Pool orientation: WETH is token1 in USDC/WETH because USDC sorts first. */
  readonly wethIsToken0: boolean;
}
export const UNISWAP_V3_PAIRS: readonly UniswapV3PairPin[] = [
  { outputToken: UNISWAP_USDC, outputSymbol: "USDC", outputDecimals: 6, pool: UNISWAP_V3_USDC_WETH_500, fee: 500, wethIsToken0: false },
];

export const UNISWAP_V3_KEYLESS_MECHANISM_PIN: SwapMechanismPin = validateSwapMechanismPin({
  schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm", chain: "eip155:1",
  protocolVersion: UNISWAP_ROUTER_VERSION, constructorKind: "sdk", constructorIdentity: "apn.uniswap-v3.quoter-v2.local-encoder",
  constructorVersion: "1.0.0", routerProgramIdentity: UNISWAP_ROUTER,
  auxiliaryContractProgramIdentities: [UNISWAP_V3_QUOTER_V2, UNISWAP_V3_FACTORY, UNISWAP_WETH9, UNISWAP_V3_USDC_WETH_500],
  quoteSchemaVersion: "quoter-v2.quote-exact-input-single.1",
  transactionSchemaVersion: "universal-router-2.2.0.wrap-eth-v3-exact-in.1",
  validationPolicyIdentity: "apn.uniswap.ethereum-native-v3-keyless", validationPolicyVersion: "1.0.0",
});
/** Official identity only. Owners must still admit both assets with this exact pin under a sealed policy. */
export const UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry = compileSwapProtocolRegistry({
  registryVersion: "uniswap-v3-keyless.2026-09-18", pins: [UNISWAP_V3_KEYLESS_MECHANISM_PIN],
});

export function uniswapV3Pair(outputToken: string): UniswapV3PairPin {
  const pair = UNISWAP_V3_PAIRS.find((row) => row.outputToken === outputToken);
  if (pair === undefined) blocked("The keyless Uniswap pair is not pinned.", "uniswap_pair_unpinned");
  return pair;
}

/** Verifies the code pins a quote or send depends on at one exact block tag; drift fails closed. */
export type UniswapV3PinVerifier = (call: EvmRpcCall, tag: Hex) => Promise<readonly UniswapV3CodePin[]>;

/** Production verifier: every pinned runtime code hash, plus the USDC proxy implementation address and code. */
export const verifyUniswapV3CodePins: UniswapV3PinVerifier = async (call, tag) =>
  await verifyCodePins(call, tag, UNISWAP_V3_CODE_PINS, { proxy: UNISWAP_USDC, slot: USDC_IMPLEMENTATION_SLOT, pin: USDC_IMPLEMENTATION_PIN });

export async function verifyCodePins(call: EvmRpcCall, tag: Hex, pins: readonly UniswapV3CodePin[],
  implementation: { readonly proxy: string; readonly slot: Hex; readonly pin: UniswapV3CodePin }): Promise<readonly UniswapV3CodePin[]> {
  const verified: UniswapV3CodePin[] = [];
  for (const pin of pins) verified.push(await verifyCode(call, pin, tag));
  const word = evmRpcHex(await call("eth_getStorageAt", [implementation.proxy, implementation.slot, tag]), 32);
  if (!/^0x0{24}/u.test(word) || getAddress(`0x${word.slice(26)}`) !== implementation.pin.address) {
    blocked("The USDC proxy implementation changed from its pinned address.", "uniswap_code_pin_drift");
  }
  verified.push(await verifyCode(call, implementation.pin, tag));
  return verified;
}

async function verifyCode(call: EvmRpcCall, pin: UniswapV3CodePin, tag: Hex): Promise<UniswapV3CodePin> {
  const code = evmRpcHex(await call("eth_getCode", [pin.address, tag]));
  if (code === "0x" || code.length > 2 + 2 * 49_152 || keccak256(code) !== pin.codeHash) {
    blocked(`Pinned ${pin.role} runtime code changed or is missing.`, "uniswap_code_pin_drift");
  }
  return pin;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
