import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHex } from "../../tron/codec.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import {
  SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, SUNSWAP_PINNED_CONTRACTS, SUNSWAP_USDT, SUNSWAP_V2_CODE_HASHES, SUNSWAP_V2_ROUTER,
  SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX, loadSunSwapPinCatalog, type SunSwapPinnedContract,
} from "./catalog.js";
import { assertSunSwapHeadDrift, sunSwapBlockReference, sunSwapHead, triggerSunSwapConstant, type SunSwapBlockReference } from "./tron-call.js";

const ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
export const SUNSWAP_MARKET_SCHEMA = "apn.sunswap-tron-v2-market.v1" as const;
const LP_FEE_NUMERATOR = 997n, LP_FEE_DENOMINATOR = 1000n;
const MAX_RUNTIME_HEX = 2 * 65_536;

export interface SunSwapV2Market {
  readonly schemaVersion: typeof SUNSWAP_MARKET_SCHEMA;
  readonly rpcOriginHash: string;
  readonly referenceBlock: SunSwapBlockReference;
  readonly headBlockNumber: string;
  readonly maxHeadDrift: number;
  readonly router: typeof SUNSWAP_V2_ROUTER;
  readonly pair: typeof SUNSWAP_V2_WTRX_USDT_PAIR;
  readonly path: readonly string[];
  readonly codeHashes: Readonly<Record<SunSwapPinnedContract, string>>;
  readonly amountInAtomic: string;
  readonly amountOutAtomic: string;
  readonly reserveInAtomic: string;
  readonly reserveOutAtomic: string;
  readonly reserveTimestampSeconds: string;
  readonly amountsOutResultHex: string;
  readonly reservesResultHex: string;
  readonly routeHash: string;
}
export interface SunSwapV2Pricing {
  readonly expectedOutputAtomic: string; readonly minimumOutputAtomic: string;
  readonly slippageBps: number; readonly ownerSlippageCapBps: number;
  readonly spotOutputAtomic: string; readonly spotPriceUsdtPerTrx: string; readonly executionPriceUsdtPerTrx: string;
  readonly priceImpactBps: string; readonly lpFeeBps: "30";
}
export interface SunSwapV2MarketRequest { readonly caller: string; readonly amountInAtomic: string }

/** Reads price, output and reserves directly from the pinned router and pair; no quote API and no API key. */
export async function readSunSwapV2Market(rpc: TronRpcPort, request: SunSwapV2MarketRequest): Promise<SunSwapV2Market> {
  loadSunSwapPinCatalog();
  if (!isPlainRecord(request) || !exactKeys(request, ["caller", "amountInAtomic"]) || typeof request.caller !== "string" ||
      tronAddress(request.caller) !== request.caller) invalid();
  const amountIn = safeAmount(request.amountInAtomic);
  const reference = sunSwapBlockReference(await sunSwapHead(rpc));
  const codeHashes = {} as Record<SunSwapPinnedContract, string>;
  for (const { role, address } of SUNSWAP_PINNED_CONTRACTS) codeHashes[role] = await verifyPinnedCode(rpc, address, SUNSWAP_V2_CODE_HASHES[role]);
  const amounts = await triggerSunSwapConstant(rpc, { owner: request.caller, contract: SUNSWAP_V2_ROUTER, callValueAtomic: "0",
    data: encodeFunctionData({ abi: ABI, functionName: "getAmountsOut", args: [amountIn, [abi(SUNSWAP_WTRX), abi(SUNSWAP_USDT)]] }).slice(2) });
  const reserves = await triggerSunSwapConstant(rpc, { owner: request.caller, contract: SUNSWAP_V2_WTRX_USDT_PAIR, callValueAtomic: "0",
    data: encodeFunctionData({ abi: ABI, functionName: "getReserves" }).slice(2) });
  const headBlockNumber = assertSunSwapHeadDrift(reference, await sunSwapHead(rpc));
  const decodedAmounts = decodeAmounts(amounts.resultHex, "input"), decodedReserves = decodeReserves(reserves.resultHex, "input");
  if (decodedAmounts[0] !== amountIn.toString()) failure("input");
  const body = { schemaVersion: SUNSWAP_MARKET_SCHEMA, rpcOriginHash: rpc.originHash, referenceBlock: reference, headBlockNumber,
    maxHeadDrift: SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, router: SUNSWAP_V2_ROUTER, pair: SUNSWAP_V2_WTRX_USDT_PAIR,
    path: [SUNSWAP_WTRX, SUNSWAP_USDT], codeHashes, amountInAtomic: decodedAmounts[0], amountOutAtomic: decodedAmounts[1],
    reserveInAtomic: decodedReserves[0], reserveOutAtomic: decodedReserves[1], reserveTimestampSeconds: decodedReserves[2],
    amountsOutResultHex: amounts.resultHex, reservesResultHex: reserves.resultHex };
  return sealSunSwapV2Market(body);
}

/** Seals decoded market evidence with its route hash after full re-validation. */
export function sealSunSwapV2Market(body: Omit<SunSwapV2Market, "routeHash">): SunSwapV2Market {
  return validateSunSwapV2Market({ ...body, routeHash: routeHash(body) }, "input");
}

/** Re-derives every market binding; used for fresh reads and for persisted prepared material. */
export function validateSunSwapV2Market(value: unknown, mode: "input" | "stored"): SunSwapV2Market {
  const fail: () => never = () => failure(mode);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "rpcOriginHash", "referenceBlock", "headBlockNumber", "maxHeadDrift",
    "router", "pair", "path", "codeHashes", "amountInAtomic", "amountOutAtomic", "reserveInAtomic", "reserveOutAtomic",
    "reserveTimestampSeconds", "amountsOutResultHex", "reservesResultHex", "routeHash"]) || value.schemaVersion !== SUNSWAP_MARKET_SCHEMA ||
      typeof value.rpcOriginHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.rpcOriginHash) || value.router !== SUNSWAP_V2_ROUTER ||
      value.pair !== SUNSWAP_V2_WTRX_USDT_PAIR || canonicalJson(value.path) !== canonicalJson([SUNSWAP_WTRX, SUNSWAP_USDT]) ||
      canonicalJson(value.codeHashes) !== canonicalJson(SUNSWAP_V2_CODE_HASHES) || value.maxHeadDrift !== SUNSWAP_MAX_HEAD_DRIFT_BLOCKS ||
      typeof value.amountsOutResultHex !== "string" || typeof value.reservesResultHex !== "string") fail();
  const block = value.referenceBlock;
  if (!isPlainRecord(block) || !exactKeys(block, ["number", "id", "timestampMs"]) || typeof block.id !== "string" ||
      !/^[a-f0-9]{64}$/u.test(block.id) || block.number !== BigInt(`0x${block.id.slice(0, 16)}`).toString() ||
      typeof block.timestampMs !== "string" || !/^[1-9][0-9]{0,15}$/u.test(block.timestampMs) || typeof value.headBlockNumber !== "string" ||
      !/^[1-9][0-9]{0,19}$/u.test(value.headBlockNumber)) fail();
  const drift = BigInt(value.headBlockNumber as string) - BigInt(block.number as string);
  if (drift < 0n || drift > BigInt(SUNSWAP_MAX_HEAD_DRIFT_BLOCKS)) fail();
  const amounts = decodeAmounts(value.amountsOutResultHex as string, mode), reserves = decodeReserves(value.reservesResultHex as string, mode);
  if (value.amountInAtomic !== amounts[0] || value.amountOutAtomic !== amounts[1] || value.reserveInAtomic !== reserves[0] ||
      value.reserveOutAtomic !== reserves[1] || value.reserveTimestampSeconds !== reserves[2]) fail();
  safeAmount(amounts[0], mode);
  const amountIn = BigInt(amounts[0]), reserveIn = BigInt(reserves[0]), reserveOut = BigInt(reserves[1]);
  const formula = (amountIn * LP_FEE_NUMERATOR * reserveOut) / (reserveIn * LP_FEE_DENOMINATOR + amountIn * LP_FEE_NUMERATOR);
  if (formula.toString() !== amounts[1]) {
    if (mode === "stored") fail();
    throw new ApnError("APN_OPERATION_BLOCKED", "Router getAmountsOut and pair getReserves disagree; request a fresh quote.",
      { reason: "sunswap_reserve_drift" });
  }
  const { routeHash: stored, ...body } = value;
  if (stored !== routeHash(body)) fail();
  return value as unknown as SunSwapV2Market;
}

/** Exact integer pricing: minimum output from the slippage bound and price impact against the reserve spot price. */
export function priceSunSwapV2Market(marketValue: SunSwapV2Market, slippageBps: number, ownerSlippageCapBps: number,
  mode: "input" | "stored" = "input"): SunSwapV2Pricing {
  const market = validateSunSwapV2Market(marketValue, mode);
  if (!basisPoints(slippageBps) || !basisPoints(ownerSlippageCapBps) || slippageBps > ownerSlippageCapBps) {
    throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", "SunSwap slippage must be an integer within the owner cap.");
  }
  const amountIn = BigInt(market.amountInAtomic), out = BigInt(market.amountOutAtomic);
  const reserveIn = BigInt(market.reserveInAtomic), reserveOut = BigInt(market.reserveOutAtomic);
  const minimum = (out * BigInt(10_000 - slippageBps) + 9_999n) / 10_000n;
  if (out <= 0n || minimum <= 0n) {
    throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap exact input yields no USDT output floor.", { reason: "sunswap_zero_output" });
  }
  const spotNumerator = amountIn * reserveOut, impactNumerator = spotNumerator - out * reserveIn;
  if (impactNumerator < 0n) failure(mode);
  return { expectedOutputAtomic: out.toString(), minimumOutputAtomic: minimum.toString(), slippageBps, ownerSlippageCapBps,
    spotOutputAtomic: (spotNumerator / reserveIn).toString(), spotPriceUsdtPerTrx: ratio(reserveOut, reserveIn),
    executionPriceUsdtPerTrx: ratio(out, amountIn), priceImpactBps: ((impactNumerator * 10_000n + spotNumerator - 1n) / spotNumerator).toString(),
    lpFeeBps: "30" };
}

async function verifyPinnedCode(rpc: TronRpcPort, address: string, expected: string): Promise<string> {
  let value: unknown;
  try { value = await rpc.call("wallet/getcontractinfo", { value: tronHex(address), visible: false }); }
  catch (error) {
    if (error instanceof ApnError && (error.code === "APN_RPC_CONFIG" || error.code === "APN_RPC_PROTOCOL")) throw error;
    throw new ApnError("APN_RPC_PROTOCOL", "TRON contract code evidence is unavailable.");
  }
  if (!isPlainRecord(value) || !isPlainRecord(value.smart_contract) || typeof value.runtimecode !== "string" ||
      value.runtimecode.length > MAX_RUNTIME_HEX || !/^(?:[a-f0-9]{2})+$/u.test(value.runtimecode) ||
      value.smart_contract.contract_address !== tronHex(address)) failure("input");
  const runtime = keccak256(`0x${value.runtimecode as string}` as Hex).slice(2);
  if (runtime !== expected || value.smart_contract.code_hash !== expected) {
    throw new ApnError("APN_OPERATION_BLOCKED", "A SunSwap contract no longer matches its pinned code hash.",
      { reason: "sunswap_code_hash_mismatch", contract: address });
  }
  return runtime;
}
function decodeAmounts(hex: string, mode: "input" | "stored"): readonly [string, string] {
  try {
    const amounts = decodeFunctionResult({ abi: ABI, functionName: "getAmountsOut", data: `0x${hex}` as Hex });
    if (hex.length !== 256 || amounts.length !== 2) throw new Error();
    return [amounts[0]!.toString(), amounts[1]!.toString()];
  } catch { return failure(mode); }
}
function decodeReserves(hex: string, mode: "input" | "stored"): readonly [string, string, string] {
  try {
    const [reserve0, reserve1, timestamp] = decodeFunctionResult({ abi: ABI, functionName: "getReserves", data: `0x${hex}` as Hex });
    if (reserve0 <= 0n || reserve1 <= 0n || hex.length !== 192) throw new Error();
    return [reserve0.toString(), reserve1.toString(), timestamp.toString()];
  } catch { return failure(mode); }
}
function routeHash(body: Readonly<Record<string, unknown>>): string { return domainHash("apn.sunswap-tron-v2-route.v1", canonicalJson(body)); }
function ratio(numerator: bigint, denominator: bigint): string {
  const scaled = (numerator * 1_000_000_000_000n) / denominator, text = scaled.toString().padStart(13, "0");
  return `${text.slice(0, -12)}.${text.slice(-12)}`;
}
function basisPoints(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 10_000; }
function safeAmount(value: unknown, mode: "input" | "stored" = "input"): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return mode === "input" ? invalid() : failure(mode);
  }
  return BigInt(value);
}
function abi(address: string): Address { return `0x${tronHex(address).slice(2)}` as Address; }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "SunSwap market request must name a canonical owner and positive safe SUN amount."); }
function failure(mode: "input" | "stored"): never {
  if (mode === "stored") throw new ApnError("APN_STATE_CORRUPT", "Persisted SunSwap market evidence failed validation.");
  throw new ApnError("APN_RPC_PROTOCOL", "TRON returned SunSwap market evidence with an invalid shape or binding.");
}
