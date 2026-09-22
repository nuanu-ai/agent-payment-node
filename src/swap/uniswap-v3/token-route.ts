import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { ETHEREUM_USDT, UNISWAP_V3_FACTORY, UNISWAP_V3_CODE_PINS, USDC_IMPLEMENTATION_PIN,
  USDC_IMPLEMENTATION_SLOT } from "./pins.js";
import { UNISWAP_USDC } from "../uniswap-pin.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { tokenBatch, type TokenRpcCall } from "./token-rpc.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
export const UNISWAP_V3_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as const;
export const UNISWAP_V3_USDC_USDT_100 = "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6" as const;
export const UNISWAP_V3_SWAP_ROUTER_CODE_HASH = "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea" as const;
export const UNISWAP_V3_USDC_USDT_100_CODE_HASH = "0x2ff673bacc60a73fc85c678888296c6bce3de2a9d7475c032fe7aa6e0eacba86" as const;
export const UNISWAP_TOKEN_ROUTE_SCHEMA = "apn.uniswap-v3.swap-router.exact-input-single.v1" as const;
const ROUTER = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
const ERC20 = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const USDT_SAFETY = parseAbi(["function deprecated() view returns (bool)", "function basisPointsRate() view returns (uint256)",
  "function maximumFee() view returns (uint256)"]);
export const UNISWAP_TOKEN_MECHANISM_PIN = validateSwapMechanismPin({ schemaVersion: SWAP_MECHANISM_PIN_SCHEMA,
    protocolFamily: "uniswap_ethereum", networkFamily: "evm", chain: "eip155:1", protocolVersion: "v3-swap-router-1",
    constructorKind: "sdk", constructorIdentity: "apn.uniswap-v3.swap-router.exact-input-single", constructorVersion: "1.0.0",
    routerProgramIdentity: UNISWAP_V3_SWAP_ROUTER, auxiliaryContractProgramIdentities: [UNISWAP_V3_FACTORY, UNISWAP_V3_USDC_USDT_100],
    quoteSchemaVersion: "quoter-v2.quote-exact-input-single.1", transactionSchemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA,
    validationPolicyIdentity: "apn.uniswap.ethereum-token-v3-exact", validationPolicyVersion: "1.0.0" });
export const UNISWAP_TOKEN_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "uniswap-v3-token.2026-09-22", pins: [UNISWAP_TOKEN_MECHANISM_PIN] });
export interface UniswapTokenRoute {
    readonly schemaVersion: typeof UNISWAP_TOKEN_ROUTE_SCHEMA;
    readonly inputToken: string;
    readonly outputToken: string;
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
    readonly router: typeof UNISWAP_V3_SWAP_ROUTER;
    readonly pool: typeof UNISWAP_V3_USDC_USDT_100;
    readonly fee: 100;
    readonly calldata: Hex;
    readonly routeHash: string;
}
export function createUniswapTokenRoute(input: {
    readonly inputToken: string;
    readonly outputToken: string;
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
}): UniswapTokenRoute {
    const tokenIn = token(input.inputToken), tokenOut = token(input.outputToken), recipient = address(input.recipient), amountIn = uint(input.amountIn), amountOutMinimum = uint(input.amountOutMinimum);
    if (tokenIn === tokenOut || !Number.isSafeInteger(input.deadline) || input.deadline <= 0)
        invalid("Uniswap token route is invalid.");
    const calldata = encodeFunctionData({ abi: ROUTER, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee: 100,
                recipient, deadline: BigInt(input.deadline), amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
    const body = { schemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA, inputToken: tokenIn, outputToken: tokenOut, recipient,
        amountIn: amountIn.toString(), amountOutMinimum: amountOutMinimum.toString(), deadline: input.deadline,
        router: UNISWAP_V3_SWAP_ROUTER, pool: UNISWAP_V3_USDC_USDT_100, fee: 100 as const, calldata };
    return validateUniswapTokenRoute({ ...body, routeHash: domainHash(UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)) });
}
export function validateUniswapTokenRoute(value: unknown): UniswapTokenRoute {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "inputToken", "outputToken", "recipient", "amountIn",
        "amountOutMinimum", "deadline", "router", "pool", "fee", "calldata", "routeHash"]))
        invalid("Uniswap token route is invalid.");
    const route = value as unknown as UniswapTokenRoute;
    const expected = createDecoded(route.calldata);
    const { routeHash, ...body } = route;
    if (canonicalJson(expected) !== canonicalJson(body) || routeHash !== domainHash(UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)))
        invalid("Uniswap token route binding changed.");
    return route;
}
function createDecoded(data: Hex): Omit<UniswapTokenRoute, "routeHash"> {
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
export function encodeUniswapTokenApproval(tokenAddress: string, amount: string): {
    readonly to: string;
    readonly spender: string;
    readonly data: Hex;
    readonly amount: string;
} {
    const to = token(tokenAddress), value = approvalAmount(amount).toString();
    return { to, spender: UNISWAP_V3_SWAP_ROUTER,
        data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [UNISWAP_V3_SWAP_ROUTER, BigInt(value)] }), amount: value };
}
export async function verifyUniswapTokenRoutePins(call: EvmRpcCall, tag: Hex): Promise<void> {
  const rpc = call as TokenRpcCall, pins = UNISWAP_V3_CODE_PINS.filter((pin) => pin.address === UNISWAP_USDC || pin.address === ETHEREUM_USDT);
  const first = await tokenBatch(rpc, "archive", [
    { method: "eth_chainId", params: [], cachePolicy: "immutable" },
    { method: "eth_getCode", params: [UNISWAP_V3_SWAP_ROUTER, tag], cachePolicy: "immutable" },
    { method: "eth_getCode", params: [UNISWAP_V3_USDC_USDT_100, tag], cachePolicy: "immutable" },
  ]);
  if (evmRpcQuantity(first[0]) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token archive requires Ethereum chain 1.");
  code(first[1], UNISWAP_V3_SWAP_ROUTER_CODE_HASH); code(first[2], UNISWAP_V3_USDC_USDT_100_CODE_HASH);
  const second = await tokenBatch(rpc, "archive", [
    { method: "eth_getCode", params: [pins[0]!.address, tag], cachePolicy: "immutable" },
    { method: "eth_getCode", params: [pins[1]!.address, tag], cachePolicy: "immutable" },
    { method: "eth_getStorageAt", params: [UNISWAP_USDC, USDC_IMPLEMENTATION_SLOT, tag], cachePolicy: "immutable" },
  ]);
  code(second[0], pins[0]!.codeHash); code(second[1], pins[1]!.codeHash);
  const word = evmRpcHex(second[2], 32);
  if (!/^0x0{24}/u.test(word) || getAddress(`0x${word.slice(26)}`) !== USDC_IMPLEMENTATION_PIN.address) blocked("USDC implementation pin changed.", "uniswap_code_pin_drift");
  const safety = await tokenBatch(rpc, "archive", [
    { method: "eth_getCode", params: [USDC_IMPLEMENTATION_PIN.address, tag], cachePolicy: "immutable" },
    ...["deprecated", "basisPointsRate"].map((functionName) => ({ method: "eth_call", params: [{ to: ETHEREUM_USDT,
      data: encodeFunctionData({ abi: USDT_SAFETY, functionName: functionName as "deprecated" | "basisPointsRate" }) }, tag], cachePolicy: "immutable" as const })),
  ]);
  code(safety[0], USDC_IMPLEMENTATION_PIN.codeHash);
  assertUsdtSafety("deprecated", safety[1]); assertUsdtSafety("basisPointsRate", safety[2]);
  const [maximumFee] = await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [{ to: ETHEREUM_USDT,
    data: encodeFunctionData({ abi: USDT_SAFETY, functionName: "maximumFee" }) }, tag], cachePolicy: "immutable" }]);
  assertUsdtSafety("maximumFee", maximumFee);
    if (UNISWAP_V3_FACTORY !== "0x1F98431c8aD98523631AE4a59f267346ea31F984")
        throw new ApnError("APN_STATE_CORRUPT", "Uniswap factory pin changed.");
}
function code(value: unknown, expected: Hex) { if (keccak256(evmRpcHex(value)) !== expected) blocked("Uniswap token route code pin changed.", "uniswap_code_pin_drift"); }
function assertUsdtSafety(functionName: "deprecated" | "basisPointsRate" | "maximumFee", value: unknown) {
  const result = decodeFunctionResult({ abi: USDT_SAFETY, functionName, data: evmRpcHex(value, 32) });
  if (result !== false && result !== 0n) blocked("USDT safety state changed from zero/non-deprecated.", "uniswap_code_pin_drift");
}
export async function verifyUniswapTokenUsdtState(call: EvmRpcCall, tag: Hex): Promise<void> {
  for (const functionName of ["deprecated", "basisPointsRate", "maximumFee"] as const) {
    const result = decodeFunctionResult({ abi: USDT_SAFETY, functionName,
      data: evmRpcHex(await call("eth_call", [{ to: ETHEREUM_USDT, data: encodeFunctionData({ abi: USDT_SAFETY, functionName }) }, tag]), 32) });
    if (result !== false && result !== 0n) blocked("USDT safety state changed from zero/non-deprecated.", "uniswap_code_pin_drift");
  }
}
function token(value: string) { const v = address(value); if (v !== UNISWAP_USDC && v !== ETHEREUM_USDT)
    invalid("Only canonical Ethereum USDC and USDT are admitted."); return v; }
function address(value: string) { try {
    const v = getAddress(value);
    if (v !== value || /^0x0{40}$/u.test(v))
        throw new Error();
    return v;
}
catch {
    return invalid("Uniswap address is invalid.");
} }
function uint(value: string) { try {
    return parseAtomic(value, { positive: true });
}
catch {
    return invalid("Uniswap amount is invalid.");
} }
function approvalAmount(value: string) { try { return parseAtomic(value); } catch { return invalid("Uniswap approval amount is invalid."); } }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
