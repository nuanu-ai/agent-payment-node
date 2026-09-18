import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHex } from "../../tron/codec.js";
import { SUNSWAP_USDT, SUNSWAP_V2_ROUTER, SUNSWAP_WTRX, loadSunSwapPinCatalog } from "./catalog.js";

const ABI = parseAbi(["function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)"]);
const SELECTOR = "7ff36ab5" as const;
/** selector + 4 head words + path length + two path words. */
const CALLDATA_HEX_LENGTH = 2 + 8 + 64 * 7;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface SunSwapCalldataIntent {
  readonly owner: string; readonly recipient: string; readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string; readonly deadlineSeconds: string;
}
export interface DecodedSunSwapCalldata extends SunSwapCalldataIntent {
  readonly router: typeof SUNSWAP_V2_ROUTER; readonly selector: typeof SELECTOR;
  readonly path: readonly [typeof SUNSWAP_WTRX, typeof SUNSWAP_USDT]; readonly callValueAtomic: string;
}
export interface SunSwapV2SwapCall {
  readonly amountOutMinAtomic: string; readonly path: readonly string[]; readonly to: string; readonly deadlineSeconds: string;
}

/** Encodes the only admitted call: router.swapExactETHForTokens(minOut, [WTRX, USDT], owner, deadline) with call_value = input. */
export function encodeSunSwapCalldata(input: SunSwapCalldataIntent): Hex {
  const intent = validateIntent(input);
  return encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens",
    args: [BigInt(intent.minimumOutputAtomic), [toAbi(SUNSWAP_WTRX), toAbi(SUNSWAP_USDT)], toAbi(intent.owner), BigInt(intent.deadlineSeconds)] });
}

/** Parses exactly one canonical swapExactETHForTokens call without applying any expectation. */
export function parseSunSwapV2SwapCall(calldata: unknown): SunSwapV2SwapCall {
  if (typeof calldata !== "string" || calldata.length !== CALLDATA_HEX_LENGTH || !/^0x[0-9a-f]+$/u.test(calldata) ||
      calldata.slice(2, 10) !== SELECTOR) blocked();
  try {
    const decoded = decodeFunctionData({ abi: ABI, data: calldata as Hex });
    if (decoded.functionName !== "swapExactETHForTokens") blocked();
    const [amountOutMin, path, to, deadline] = decoded.args;
    const call = { amountOutMinAtomic: amountOutMin.toString(), path: path.map(fromAbi), to: fromAbi(to), deadlineSeconds: deadline.toString() };
    const canonical = encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens", args: [amountOutMin, path, to, deadline] });
    if (canonical.toLowerCase() !== calldata) blocked();
    return call;
  } catch { return blocked(); }
}

export function decodeSunSwapCalldata(calldata: string, callValueAtomic: string, expected: SunSwapCalldataIntent): DecodedSunSwapCalldata {
  loadSunSwapPinCatalog(); const intent = validateIntent(expected);
  if (atomic(callValueAtomic) !== intent.inputAmountAtomic) blocked();
  const call = parseSunSwapV2SwapCall(calldata);
  if (call.amountOutMinAtomic !== intent.minimumOutputAtomic || call.path.length !== 2 || call.path[0] !== SUNSWAP_WTRX ||
      call.path[1] !== SUNSWAP_USDT || call.to !== intent.owner || call.deadlineSeconds !== intent.deadlineSeconds ||
      encodeSunSwapCalldata(intent) !== calldata) blocked();
  return { ...intent, router: SUNSWAP_V2_ROUTER, selector: SELECTOR, path: [SUNSWAP_WTRX, SUNSWAP_USDT], callValueAtomic: intent.inputAmountAtomic };
}

function validateIntent(input: SunSwapCalldataIntent): SunSwapCalldataIntent {
  loadSunSwapPinCatalog();
  if (!isPlainRecord(input) || !exactKeys(input, ["owner", "recipient", "inputAmountAtomic", "minimumOutputAtomic", "deadlineSeconds"])) invalid();
  if (typeof input.owner !== "string" || typeof input.recipient !== "string" || tronAddress(input.owner) !== input.owner ||
      input.recipient !== input.owner) invalid();
  const amount = atomic(input.inputAmountAtomic), minimum = atomic(input.minimumOutputAtomic), deadline = atomic(input.deadlineSeconds);
  if (amount === "0" || minimum === "0" || deadline === "0") invalid();
  return { owner: input.owner, recipient: input.recipient, inputAmountAtomic: amount, minimumOutputAtomic: minimum, deadlineSeconds: deadline };
}
function atomic(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) > MAX_UINT256) invalid();
  return value;
}
function toAbi(address: string): Address { return `0x${tronHex(address).slice(2)}` as Address; }
function fromAbi(address: Address): string { return tronAddress(`41${address.slice(2).toLowerCase()}`); }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "SunSwap V2 calldata intent is invalid; the recipient must be the owner account."); }
function blocked(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap calldata is not the single swapExactETHForTokens(WTRX->USDT, to=owner) call admitted by the frozen policy.");
}
