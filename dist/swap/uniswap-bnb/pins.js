import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { binancePegPolicyAsset } from "../../binance-peg-policy-assets.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex } from "../../evm-rpc-codec.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { nativeReads } from "../uniswap-v3/native-rpc.js";
import { verifyCodeValue } from "../uniswap-v3/pins.js";
/**
 * Keyless Uniswap V3 on BNB Smart Chain: native BNB, wrapped by SwapRouter02 into WBNB, to Binance-Peg USDT or USDC.
 * Every address is Uniswap's published BNB deployment (developers.uniswap.org, v3 BNB deployments) and was read on
 * chain 56 on 2026-11-23 (blocks 135271904 to 135273482): eth_getCode of each contract, QuoterV2.factory/WETH9 and
 * SwapRouter02.factory/WETH9, pool token0/token1/fee/factory and factory.getPool for every fee tier, and one same-block
 * SwapRouter02 simulation per pair whose amountOutMinimum equals the QuoterV2 output (quoted + 1 reverts "Too little
 * received"; a past deadline reverts "Transaction too old"). Runtime code carries each contract's immutables, so each
 * hash also pins them; quote time re-verifies the hashes and any drift fails closed.
 */
export const BNB_CHAIN = "eip155:56";
export const BNB_CHAIN_ID = 56;
export const BNB_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
export const BNB_UNISWAP_V3_FACTORY = "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7";
export const BNB_UNISWAP_QUOTER_V2 = "0x78D78E420Da98ad378D7799bE8f4AF69033EB077";
export const BNB_UNISWAP_SWAP_ROUTER_02 = "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2";
export const BNB_USDT = "0x55d398326f99059fF775485246999027B3197955";
export const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
/**
 * The deepest in-range WBNB pool of each pair among the 100/500/3000/10000 tiers (block 135271904): USDT/WBNB 500 holds
 * liquidity 9.21e23 against 5.9e22 for the 100 tier; USDC/WBNB 500 holds 9.79e20 against 6.9e20 for the 100 tier.
 * USDC/WBNB is thin: 1 BNB quoted 2.6% under the USDT pool, so the owner's slippage cap refuses large inputs.
 */
export const BNB_UNISWAP_USDT_WBNB_500 = "0x6fe9E9de56356F7eDBfcBB29FAB7cd69471a4869";
export const BNB_UNISWAP_USDC_WBNB_500 = "0x5289A8Dbf7029eE0b0498a84777ed3941D9acfEc";
/** EIP-1967 implementation slot of the upgradeable proxy behind Binance-Peg USDC; Binance-Peg USDT has no proxy. */
export const BNB_USDC_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const BNB_UNISWAP_CODE_PINS = [
    { role: "swap_router_02", address: BNB_UNISWAP_SWAP_ROUTER_02, codeHash: "0xb5d42e79aedc88b789afbba7720e705afc985a56083c52f1ac66d094f31ef76b" },
    { role: "quoter_v2", address: BNB_UNISWAP_QUOTER_V2, codeHash: "0xb6652d71ca265e7b2b5f066661fec38c8c22eb9a9c17b8a5c0fae62ec401bc55" },
    { role: "v3_factory", address: BNB_UNISWAP_V3_FACTORY, codeHash: "0x34b1009d0f004e58da791225992645e2df7697ac71ac89dc5e80469c4ef7e322" },
    { role: "wbnb", address: BNB_WBNB, codeHash: "0xb7d84205eaaf83ce7b3940c6beaad6d22790255e34a9a2b486aa8cdfff118fe6" },
    { role: "usdt", address: BNB_USDT, codeHash: "0x97a48aa4c129657440dafdacd4c836389734d28cc4a0ca7403e68da660a74a59" },
    { role: "usdc_proxy", address: BNB_USDC, codeHash: "0x56069ff2fd59ae482f7984aa894b6d3bc84cb910354dcda9cd6c828d61526914" },
    { role: "pool_usdt_wbnb_500", address: BNB_UNISWAP_USDT_WBNB_500, codeHash: "0x6e1ffbcc13981d8074e41a0b052d2f573cc0604441757219657dae501d1f862d" },
    { role: "pool_usdc_wbnb_500", address: BNB_UNISWAP_USDC_WBNB_500, codeHash: "0xd4bcc329a61f8c2ae56fe2aab69b1635c1289b5a343127f9e49839b2898e16a7" },
];
export const BNB_USDC_IMPLEMENTATION_PIN = { role: "usdc_implementation",
    address: "0xBA5Fe23f8a3a24BEd3236F05F2FcF35fd0BF0B5C", codeHash: "0xd2d7cf7504e1cb572af28476d45907fc30bee1297917bed153e6fbba125821a3" };
/** WBNB sorts after both tokens, so it is token1 of both pools. */
export const BNB_UNISWAP_PAIRS = [
    { outputToken: BNB_USDT, outputSymbol: "USDT", outputDecimals: 18, pool: BNB_UNISWAP_USDT_WBNB_500, fee: 500, wethIsToken0: false },
    { outputToken: BNB_USDC, outputSymbol: "USDC", outputDecimals: 18, pool: BNB_UNISWAP_USDC_WBNB_500, fee: 500, wethIsToken0: false },
];
export const BNB_UNISWAP_MECHANISM_PIN = validateSwapMechanismPin({
    schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_bnb", networkFamily: "evm", chain: BNB_CHAIN,
    protocolVersion: "swap-router-02", constructorKind: "sdk", constructorIdentity: "apn.uniswap-v3.bnb.quoter-v2.local-encoder",
    constructorVersion: "1.0.0", routerProgramIdentity: BNB_UNISWAP_SWAP_ROUTER_02,
    auxiliaryContractProgramIdentities: [BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_V3_FACTORY, BNB_WBNB, BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_USDC_WBNB_500],
    quoteSchemaVersion: "quoter-v2.quote-exact-input-single.1",
    transactionSchemaVersion: "swap-router-02.multicall-deadline.exact-input-single.1",
    validationPolicyIdentity: "apn.uniswap.bnb-native-v3-keyless", validationPolicyVersion: "1.0.0",
});
/** Official identity only. Owners must still admit native BNB and the output token with this route under a sealed policy. */
export const BNB_UNISWAP_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "uniswap-bnb-keyless.2026-11-23", pins: [BNB_UNISWAP_MECHANISM_PIN],
});
/**
 * The pinned pair of one output token. Its symbol and decimals must equal the reviewed Binance-Peg supplement row the
 * quote and the owner policy resolve, so the amounts shown and the amounts admitted use one scale.
 */
export function bnbUniswapPair(outputToken) {
    const pair = BNB_UNISWAP_PAIRS.find((row) => row.outputToken === outputToken);
    if (pair === undefined)
        blocked("The keyless BNB Uniswap pair is not pinned.", "uniswap_pair_unpinned");
    assertBnbPairMatchesAsset(pair, binancePegPolicyAsset(BNB_CHAIN, "token", pair.outputToken));
    return pair;
}
export function assertBnbPairMatchesAsset(pair, asset) {
    if (asset === undefined || asset.chain !== BNB_CHAIN || asset.identifier !== pair.outputToken || asset.decimals !== pair.outputDecimals ||
        asset.symbol !== pair.outputSymbol) {
        blocked("The BNB pair pin disagrees with the reviewed token's symbol or decimals.", "uniswap_bnb_decimals_mismatch");
    }
}
const IDENTITY_ABI = parseAbi(["function decimals() view returns (uint8)", "function getPool(address,address,uint24) view returns (address)"]);
/**
 * Quote-time verifier: decimals() of both tokens (a storage value no code hash fixes) and the official factory's pool of
 * each pinned pair, then every pinned runtime code hash and the USDC proxy implementation.
 */
export const verifyBnbUniswapCodePins = async (call, tag) => {
    const reads = [...BNB_UNISWAP_PAIRS.map((pair) => ({ method: "eth_call", params: [{ to: pair.outputToken,
                    data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: "decimals" }) }, tag] })),
        ...BNB_UNISWAP_PAIRS.map((pair) => ({ method: "eth_call", params: [{ to: BNB_UNISWAP_V3_FACTORY,
                    data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: "getPool", args: [BNB_WBNB, pair.outputToken, pair.fee] }) }, tag] }))];
    const values = await batchedReads(call, reads);
    BNB_UNISWAP_PAIRS.forEach((pair, index) => {
        if (decodeFunctionResult({ abi: IDENTITY_ABI, functionName: "decimals", data: evmRpcHex(values[index]) }) !== pair.outputDecimals) {
            blocked(`On-chain ${pair.outputSymbol} decimals differ from the pinned ${pair.outputDecimals}.`, "uniswap_bnb_decimals_mismatch");
        }
        if (decodeFunctionResult({ abi: IDENTITY_ABI, functionName: "getPool", data: evmRpcHex(values[BNB_UNISWAP_PAIRS.length + index]) }) !== pair.pool) {
            blocked(`The official factory's WBNB/${pair.outputSymbol} pool changed.`, "uniswap_code_pin_drift");
        }
    });
    const codes = await batchedReads(call, BNB_UNISWAP_CODE_PINS.map((pin) => ({ method: "eth_getCode", params: [pin.address, tag] })));
    BNB_UNISWAP_CODE_PINS.forEach((pin, index) => verifyCodeValue(codes[index], pin));
    await verifyUsdcImplementation(call, tag);
    return [...BNB_UNISWAP_CODE_PINS, BNB_USDC_IMPLEMENTATION_PIN];
};
/**
 * Send-time verifier (SWAP-17 on BNB): only the upgradeable USDC proxy's implementation. The router, quoter, factory, WBNB,
 * USDT and the pools have no upgrade path; their hashes and the token decimals were verified once at quote.
 */
export const verifyBnbUniswapMutablePins = async (call, tag) => {
    await verifyUsdcImplementation(call, tag);
    return [BNB_USDC_IMPLEMENTATION_PIN];
};
async function verifyUsdcImplementation(call, tag) {
    const word = evmRpcHex((await nativeReads(call, [{ method: "eth_getStorageAt", params: [BNB_USDC, BNB_USDC_IMPLEMENTATION_SLOT, tag] }]))[0], 32);
    if (!/^0x0{24}/u.test(word) || getAddress(`0x${word.slice(26)}`) !== BNB_USDC_IMPLEMENTATION_PIN.address) {
        blocked("The Binance-Peg USDC proxy implementation changed from its pinned address.", "uniswap_code_pin_drift");
    }
    verifyCodeValue((await nativeReads(call, [{ method: "eth_getCode", params: [BNB_USDC_IMPLEMENTATION_PIN.address, tag] }]))[0], BNB_USDC_IMPLEMENTATION_PIN);
}
/** Provider-compatible groups of at most three reads, or one by one on a scalar transport. */
async function batchedReads(call, items) {
    const values = [];
    for (let index = 0; index < items.length; index += 3)
        values.push(...await nativeReads(call, items.slice(index, index + 3)));
    return values;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=pins.js.map