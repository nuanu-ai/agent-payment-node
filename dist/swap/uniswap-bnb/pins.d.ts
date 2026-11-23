import type { CandidateAsset } from "../../allowlist-inventory.js";
import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
import { type UniswapV3CodePin, type UniswapV3PairPin, type UniswapV3PinVerifier } from "../uniswap-v3/pins.js";
/**
 * Keyless Uniswap V3 on BNB Smart Chain: native BNB, wrapped by SwapRouter02 into WBNB, to Binance-Peg USDT or USDC.
 * Every address is Uniswap's published BNB deployment (developers.uniswap.org, v3 BNB deployments) and was read on
 * chain 56 on 2026-11-23 (blocks 135271904 to 135273482): eth_getCode of each contract, QuoterV2.factory/WETH9 and
 * SwapRouter02.factory/WETH9, pool token0/token1/fee/factory and factory.getPool for every fee tier, and one same-block
 * SwapRouter02 simulation per pair whose amountOutMinimum equals the QuoterV2 output (quoted + 1 reverts "Too little
 * received"; a past deadline reverts "Transaction too old"). Runtime code carries each contract's immutables, so each
 * hash also pins them; quote time re-verifies the hashes and any drift fails closed.
 */
export declare const BNB_CHAIN: "eip155:56";
export declare const BNB_CHAIN_ID: 56;
export declare const BNB_WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
export declare const BNB_UNISWAP_V3_FACTORY: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7";
export declare const BNB_UNISWAP_QUOTER_V2: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077";
export declare const BNB_UNISWAP_SWAP_ROUTER_02: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2";
export declare const BNB_USDT: "0x55d398326f99059fF775485246999027B3197955";
export declare const BNB_USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
/**
 * The deepest in-range WBNB pool of each pair among the 100/500/3000/10000 tiers (block 135271904): USDT/WBNB 500 holds
 * liquidity 9.21e23 against 5.9e22 for the 100 tier; USDC/WBNB 500 holds 9.79e20 against 6.9e20 for the 100 tier.
 * USDC/WBNB is thin: 1 BNB quoted 2.6% under the USDT pool, so the owner's slippage cap refuses large inputs.
 */
export declare const BNB_UNISWAP_USDT_WBNB_500: "0x6fe9E9de56356F7eDBfcBB29FAB7cd69471a4869";
export declare const BNB_UNISWAP_USDC_WBNB_500: "0x5289A8Dbf7029eE0b0498a84777ed3941D9acfEc";
/** EIP-1967 implementation slot of the upgradeable proxy behind Binance-Peg USDC; Binance-Peg USDT has no proxy. */
export declare const BNB_USDC_IMPLEMENTATION_SLOT: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export declare const BNB_UNISWAP_CODE_PINS: readonly UniswapV3CodePin[];
export declare const BNB_USDC_IMPLEMENTATION_PIN: UniswapV3CodePin;
/** WBNB sorts after both tokens, so it is token1 of both pools. */
export declare const BNB_UNISWAP_PAIRS: readonly UniswapV3PairPin[];
export declare const BNB_UNISWAP_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit native BNB and the output token with this route under a sealed policy. */
export declare const BNB_UNISWAP_PROTOCOL_REGISTRY: SwapProtocolRegistry;
/**
 * The pinned pair of one output token. Its symbol and decimals must equal the reviewed Binance-Peg supplement row the
 * quote and the owner policy resolve, so the amounts shown and the amounts admitted use one scale.
 */
export declare function bnbUniswapPair(outputToken: string): UniswapV3PairPin;
export declare function assertBnbPairMatchesAsset(pair: UniswapV3PairPin, asset: CandidateAsset | undefined): void;
/**
 * Quote-time verifier: decimals() of both tokens (a storage value no code hash fixes) and the official factory's pool of
 * each pinned pair, then every pinned runtime code hash and the USDC proxy implementation.
 */
export declare const verifyBnbUniswapCodePins: UniswapV3PinVerifier;
/**
 * Send-time verifier (SWAP-17 on BNB): only the upgradeable USDC proxy's implementation. The router, quoter, factory, WBNB,
 * USDT and the pools have no upgrade path; their hashes and the token decimals were verified once at quote.
 */
export declare const verifyBnbUniswapMutablePins: UniswapV3PinVerifier;
