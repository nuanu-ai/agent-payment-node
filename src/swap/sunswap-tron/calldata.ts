import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHex } from "../../tron/codec.js";
import { SUNSWAP_NATIVE_TRX, SUNSWAP_USDT, SUNSWAP_V4_UNIVERSAL_ROUTER, loadSunSwapPinCatalog } from "./catalog.js";

const ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const V2_EXACT_IN = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" }] as const;
const COMMAND = "0x08" as const;

export interface SunSwapCalldataIntent {
  readonly owner: string; readonly recipient: string; readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string; readonly deadlineSeconds: string;
}
export interface DecodedSunSwapCalldata extends SunSwapCalldataIntent {
  readonly router: typeof SUNSWAP_V4_UNIVERSAL_ROUTER;
  readonly sourceAsset: typeof SUNSWAP_NATIVE_TRX; readonly destinationAsset: typeof SUNSWAP_USDT;
  readonly command: typeof COMMAND; readonly callValueAtomic: string;
}

export function encodeSunSwapCalldata(input: SunSwapCalldataIntent): Hex {
  const intent = validateIntent(input);
  const encoded = encodeAbiParameters(V2_EXACT_IN, [toAbi(intent.recipient), BigInt(intent.inputAmountAtomic),
    BigInt(intent.minimumOutputAtomic), [toAbi(SUNSWAP_NATIVE_TRX), toAbi(SUNSWAP_USDT)], false]);
  return encodeFunctionData({ abi: ABI, functionName: "execute", args: [COMMAND, [encoded], BigInt(intent.deadlineSeconds)] });
}

export function decodeSunSwapCalldata(calldata: string, callValueAtomic: string, expected: SunSwapCalldataIntent): DecodedSunSwapCalldata {
  loadSunSwapPinCatalog(); const intent = validateIntent(expected);
  if (!/^0x[0-9a-f]+$/u.test(calldata) || calldata.length > 16_386 || atomic(callValueAtomic) !== intent.inputAmountAtomic) blocked();
  try {
    const decoded = decodeFunctionData({ abi: ABI, data: calldata as Hex });
    if (decoded.functionName !== "execute") blocked();
    const [commands, inputs, deadline] = decoded.args;
    if (commands !== COMMAND || inputs.length !== 1 || deadline.toString() !== intent.deadlineSeconds) blocked();
    const [recipient, amountIn, minimumOut, path, payerIsUser] = decodeAbiParameters(V2_EXACT_IN, inputs[0]!);
    if (payerIsUser || fromAbi(recipient) !== intent.recipient || amountIn.toString() !== intent.inputAmountAtomic ||
        minimumOut.toString() !== intent.minimumOutputAtomic || path.length !== 2 || fromAbi(path[0]!) !== SUNSWAP_NATIVE_TRX ||
        fromAbi(path[1]!) !== SUNSWAP_USDT || encodeSunSwapCalldata(intent).toLowerCase() !== calldata) blocked();
    return { ...intent, router: SUNSWAP_V4_UNIVERSAL_ROUTER, sourceAsset: SUNSWAP_NATIVE_TRX, destinationAsset: SUNSWAP_USDT,
      command: COMMAND, callValueAtomic: intent.inputAmountAtomic };
  } catch (error) { if (error instanceof ApnError) throw error; return blocked(); }
}

function validateIntent(input: SunSwapCalldataIntent): SunSwapCalldataIntent {
  loadSunSwapPinCatalog();
  if (tronAddress(input.owner) !== input.owner || tronAddress(input.recipient) !== input.recipient) invalid();
  const amount = atomic(input.inputAmountAtomic), minimum = atomic(input.minimumOutputAtomic), deadline = atomic(input.deadlineSeconds);
  if (amount === "0" || minimum === "0" || deadline === "0") invalid();
  return { owner: input.owner, recipient: input.recipient, inputAmountAtomic: amount, minimumOutputAtomic: minimum, deadlineSeconds: deadline };
}
function atomic(value: unknown): string { if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) invalid(); return BigInt(value).toString(); }
function toAbi(address: string): Address { return `0x${tronHex(address).slice(2)}` as Address; }
function fromAbi(address: Address): string { return tronAddress(`41${address.slice(2)}`); }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "SunSwap calldata intent is invalid."); }
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap calldata is not the single atomic V2 exact-input command admitted by the frozen policy."); }
