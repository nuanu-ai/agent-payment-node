import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { ETHEREUM_USDT, UNISWAP_V3_FACTORY } from "./pins.js";
import { UNISWAP_USDC } from "../uniswap-pin.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
export const UNISWAP_V3_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const UNISWAP_V3_USDC_USDT_100 = "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6";
export const UNISWAP_V3_SWAP_ROUTER_CODE_HASH = "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea";
export const UNISWAP_V3_USDC_USDT_100_CODE_HASH = "0x2ff673bacc60a73fc85c678888296c6bce3de2a9d7475c032fe7aa6e0eacba86";
export const UNISWAP_TOKEN_ROUTE_SCHEMA = "apn.uniswap-v3.swap-router.exact-input-single.v1";
const ROUTER = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
const ERC20 = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
export const UNISWAP_TOKEN_MECHANISM_PIN = validateSwapMechanismPin({ schemaVersion: SWAP_MECHANISM_PIN_SCHEMA,
    protocolFamily: "uniswap_ethereum", networkFamily: "evm", chain: "eip155:1", protocolVersion: "v3-swap-router-1",
    constructorKind: "sdk", constructorIdentity: "apn.uniswap-v3.swap-router.exact-input-single", constructorVersion: "1.0.0",
    routerProgramIdentity: UNISWAP_V3_SWAP_ROUTER, auxiliaryContractProgramIdentities: [UNISWAP_V3_FACTORY, UNISWAP_V3_USDC_USDT_100],
    quoteSchemaVersion: "quoter-v2.quote-exact-input-single.1", transactionSchemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA,
    validationPolicyIdentity: "apn.uniswap.ethereum-token-v3-exact", validationPolicyVersion: "1.0.0" });
export const UNISWAP_TOKEN_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "uniswap-v3-token.2026-09-22", pins: [UNISWAP_TOKEN_MECHANISM_PIN] });
export function createUniswapTokenRoute(input) {
    const tokenIn = token(input.inputToken), tokenOut = token(input.outputToken), recipient = address(input.recipient), amountIn = uint(input.amountIn), amountOutMinimum = uint(input.amountOutMinimum);
    if (tokenIn === tokenOut || !Number.isSafeInteger(input.deadline) || input.deadline <= 0)
        invalid("Uniswap token route is invalid.");
    const calldata = encodeFunctionData({ abi: ROUTER, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee: 100,
                recipient, deadline: BigInt(input.deadline), amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
    const body = { schemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA, inputToken: tokenIn, outputToken: tokenOut, recipient,
        amountIn: amountIn.toString(), amountOutMinimum: amountOutMinimum.toString(), deadline: input.deadline,
        router: UNISWAP_V3_SWAP_ROUTER, pool: UNISWAP_V3_USDC_USDT_100, fee: 100, calldata };
    return validateUniswapTokenRoute({ ...body, routeHash: domainHash(UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)) });
}
export function validateUniswapTokenRoute(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "inputToken", "outputToken", "recipient", "amountIn",
        "amountOutMinimum", "deadline", "router", "pool", "fee", "calldata", "routeHash"]))
        invalid("Uniswap token route is invalid.");
    const route = value;
    const expected = createDecoded(route.calldata);
    const { routeHash, ...body } = route;
    if (canonicalJson(expected) !== canonicalJson(body) || routeHash !== domainHash(UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)))
        invalid("Uniswap token route binding changed.");
    return route;
}
function createDecoded(data) {
    try {
        const decoded = decodeFunctionData({ abi: ROUTER, data });
        if (decoded.functionName !== "exactInputSingle")
            throw new Error();
        const p = decoded.args[0];
        if (p.fee !== 100 || p.sqrtPriceLimitX96 !== 0n || p.deadline > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error();
        return { schemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA, inputToken: token(p.tokenIn), outputToken: token(p.tokenOut), recipient: address(p.recipient),
            amountIn: uint(p.amountIn.toString()).toString(), amountOutMinimum: uint(p.amountOutMinimum.toString()).toString(), deadline: Number(p.deadline),
            router: UNISWAP_V3_SWAP_ROUTER, pool: UNISWAP_V3_USDC_USDT_100, fee: 100, calldata: data };
    }
    catch {
        return invalid("Uniswap exactInputSingle calldata is invalid.");
    }
}
export function encodeUniswapTokenApproval(tokenAddress, amount) {
    const to = token(tokenAddress), value = uint(amount).toString();
    return { to, spender: UNISWAP_V3_SWAP_ROUTER,
        data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [UNISWAP_V3_SWAP_ROUTER, BigInt(value)] }), amount: value };
}
export async function verifyUniswapTokenRoutePins(call, tag) {
    for (const [addressValue, hash] of [[UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_SWAP_ROUTER_CODE_HASH],
        [UNISWAP_V3_USDC_USDT_100, UNISWAP_V3_USDC_USDT_100_CODE_HASH]]) {
        if (keccak256(evmRpcHex(await call("eth_getCode", [addressValue, tag]))) !== hash)
            blocked("Uniswap token route code pin changed.", "uniswap_code_pin_drift");
    }
    if (UNISWAP_V3_FACTORY !== "0x1F98431c8aD98523631AE4a59f267346ea31F984")
        throw new ApnError("APN_STATE_CORRUPT", "Uniswap factory pin changed.");
}
function token(value) { const v = address(value); if (v !== UNISWAP_USDC && v !== ETHEREUM_USDT)
    invalid("Only canonical Ethereum USDC and USDT are admitted."); return v; }
function address(value) { try {
    const v = getAddress(value);
    if (v !== value || /^0x0{40}$/u.test(v))
        throw new Error();
    return v;
}
catch {
    return invalid("Uniswap address is invalid.");
} }
function uint(value) { try {
    return parseAtomic(value, { positive: true });
}
catch {
    return invalid("Uniswap amount is invalid.");
} }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-route.js.map