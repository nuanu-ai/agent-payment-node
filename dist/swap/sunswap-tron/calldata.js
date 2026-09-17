import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHex } from "../../tron/codec.js";
import { SUNSWAP_NATIVE_TRX, SUNSWAP_USDT, SUNSWAP_V4_UNIVERSAL_ROUTER, loadSunSwapPinCatalog } from "./catalog.js";
const ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const V2_EXACT_IN = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" }];
const COMMAND = "0x08";
const MAX_UINT256 = (1n << 256n) - 1n;
export function encodeSunSwapCalldata(input) {
    const intent = validateIntent(input);
    const encoded = encodeAbiParameters(V2_EXACT_IN, [toAbi(intent.recipient), BigInt(intent.inputAmountAtomic),
        BigInt(intent.minimumOutputAtomic), [toAbi(SUNSWAP_NATIVE_TRX), toAbi(SUNSWAP_USDT)], false]);
    return encodeFunctionData({ abi: ABI, functionName: "execute", args: [COMMAND, [encoded], BigInt(intent.deadlineSeconds)] });
}
export function decodeSunSwapCalldata(calldata, callValueAtomic, expected) {
    loadSunSwapPinCatalog();
    const intent = validateIntent(expected);
    if (!/^0x[0-9a-f]+$/u.test(calldata) || calldata.length > 16_386 || atomic(callValueAtomic) !== intent.inputAmountAtomic)
        blocked();
    try {
        const decoded = decodeFunctionData({ abi: ABI, data: calldata });
        if (decoded.functionName !== "execute")
            blocked();
        const [commands, inputs, deadline] = decoded.args;
        if (commands !== COMMAND || inputs.length !== 1 || deadline.toString() !== intent.deadlineSeconds)
            blocked();
        const [recipient, amountIn, minimumOut, path, payerIsUser] = decodeAbiParameters(V2_EXACT_IN, inputs[0]);
        if (payerIsUser || fromAbi(recipient) !== intent.recipient || amountIn.toString() !== intent.inputAmountAtomic ||
            minimumOut.toString() !== intent.minimumOutputAtomic || path.length !== 2 || fromAbi(path[0]) !== SUNSWAP_NATIVE_TRX ||
            fromAbi(path[1]) !== SUNSWAP_USDT || encodeSunSwapCalldata(intent).toLowerCase() !== calldata)
            blocked();
        return { ...intent, router: SUNSWAP_V4_UNIVERSAL_ROUTER, sourceAsset: SUNSWAP_NATIVE_TRX, destinationAsset: SUNSWAP_USDT,
            command: COMMAND, callValueAtomic: intent.inputAmountAtomic };
    }
    catch {
        return blocked();
    }
}
function validateIntent(input) {
    loadSunSwapPinCatalog();
    if (!isPlainRecord(input) || !exactKeys(input, ["owner", "recipient", "inputAmountAtomic", "minimumOutputAtomic", "deadlineSeconds"]))
        invalid();
    if (tronAddress(input.owner) !== input.owner || tronAddress(input.recipient) !== input.recipient)
        invalid();
    const amount = atomic(input.inputAmountAtomic), minimum = atomic(input.minimumOutputAtomic), deadline = atomic(input.deadlineSeconds);
    if (amount === "0" || minimum === "0" || deadline === "0")
        invalid();
    return { owner: input.owner, recipient: input.recipient, inputAmountAtomic: amount, minimumOutputAtomic: minimum, deadlineSeconds: deadline };
}
function atomic(value) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) > MAX_UINT256)
        invalid();
    return value;
}
function toAbi(address) { return `0x${tronHex(address).slice(2)}`; }
function fromAbi(address) { return tronAddress(`41${address.slice(2)}`); }
function invalid() { throw new ApnError("APN_INVALID_INPUT", "SunSwap calldata intent is invalid."); }
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap calldata is not the single atomic V2 exact-input command admitted by the frozen policy."); }
//# sourceMappingURL=calldata.js.map