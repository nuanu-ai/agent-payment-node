import { ApnError } from "../../errors.js";
import { isPlainRecord } from "../../canonical.js";
import { tronAtomic, tronHex } from "../../tron/codec.js";
import { tronBlock } from "../../tron/rpc.js";
import { SUNSWAP_MAX_HEAD_DRIFT_BLOCKS } from "./catalog.js";
/** The exact wallet/triggerconstantcontract body for one call; addresses are 41-prefixed hex and data carries no 0x. */
export function sunSwapConstantBody(call) {
    if (!/^[a-f0-9]{8,}$/u.test(call.data) || call.data.length % 2 !== 0 || !/^(?:0|[1-9][0-9]{0,15})$/u.test(call.callValueAtomic) ||
        BigInt(call.callValueAtomic) > BigInt(Number.MAX_SAFE_INTEGER))
        invalid();
    const callValue = Number(call.callValueAtomic);
    return { owner_address: tronHex(call.owner), contract_address: tronHex(call.contract), data: call.data,
        ...(callValue === 0 ? {} : { call_value: callValue }), visible: false };
}
/**
 * Executes one read-only constant call and proves the node echoed the exact owner, contract, calldata and call value.
 * A missing owner account or insufficient call value is an economic refusal, never a protocol failure.
 */
export async function triggerSunSwapConstant(rpc, call) {
    const body = sunSwapConstantBody(call);
    let value;
    try {
        value = await rpc.call("wallet/triggerconstantcontract", body);
    }
    catch (error) {
        return unavailable(error);
    }
    if (!isPlainRecord(value) || !isPlainRecord(value.result))
        protocol();
    if (value.result.result !== true)
        refuse(value.result, call.callValueAtomic);
    const results = value.constant_result;
    if (!Array.isArray(results) || results.length !== 1 || typeof results[0] !== "string" || !/^(?:[a-f0-9]{2}){0,4096}$/u.test(results[0]))
        protocol();
    const transaction = isPlainRecord(value.transaction) ? value.transaction : protocol();
    const status = Array.isArray(transaction.ret) && transaction.ret.length === 1 && isPlainRecord(transaction.ret[0]) ? transaction.ret[0].ret : protocol();
    if (value.result.message !== undefined || value.result.code !== undefined || status === "FAILED")
        reverted(results[0]);
    if (status !== undefined && status !== "SUCESS")
        protocol();
    const energyUsed = tronAtomic(value.energy_used, true), energyPenalty = tronAtomic(value.energy_penalty, true);
    if (energyPenalty > energyUsed)
        protocol();
    const raw = isPlainRecord(transaction.raw_data) ? transaction.raw_data : protocol();
    const contracts = raw.contract;
    if (!Array.isArray(contracts) || contracts.length !== 1 || !isPlainRecord(contracts[0]) || contracts[0].type !== "TriggerSmartContract" ||
        !isPlainRecord(contracts[0].parameter) || !isPlainRecord(contracts[0].parameter.value))
        protocol();
    const echoed = contracts[0].parameter.value;
    if (echoed.owner_address !== body.owner_address || echoed.contract_address !== body.contract_address || echoed.data !== body.data ||
        tronAtomic(echoed.call_value, true).toString() !== call.callValueAtomic || tronAtomic(echoed.call_token_value, true) !== 0n)
        protocol();
    return { resultHex: results[0], energyUsed: energyUsed.toString(), energyPenalty: energyPenalty.toString() };
}
export async function sunSwapHead(rpc) {
    try {
        return tronBlock(await rpc.call("wallet/getnowblock", {}));
    }
    catch (error) {
        return unavailable(error);
    }
}
export function sunSwapBlockReference(block) {
    return { number: block.number.toString(), id: block.id, timestampMs: block.timestamp.toString() };
}
/** Every later read must observe a head at or after the recorded block and within the frozen drift bound. */
export function assertSunSwapHeadDrift(reference, head) {
    const recorded = BigInt(reference.number);
    if (head.number < recorded || head.number - recorded > BigInt(SUNSWAP_MAX_HEAD_DRIFT_BLOCKS)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "TRON head drifted outside the frozen SunSwap quote window; request a fresh quote.", { reason: "sunswap_head_drift" });
    }
    if (head.number === recorded && head.id !== reference.id)
        protocol();
    return head.number.toString();
}
/** Converts lossless RPC bigints to decimal strings so raw evidence can be canonically hashed. */
export function normalizeTronEvidence(value, depth = 0) {
    if (depth > 32)
        protocol();
    if (typeof value === "bigint")
        return value.toString();
    if (Array.isArray(value))
        return value.map((item) => normalizeTronEvidence(item, depth + 1));
    if (isPlainRecord(value))
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeTronEvidence(item, depth + 1)]));
    return value;
}
function refuse(result, callValueAtomic) {
    const message = typeof result.message === "string" && /^(?:[a-f0-9]{2}){1,512}$/u.test(result.message)
        ? Buffer.from(result.message, "hex").toString("latin1").replace(/[^\x20-\x7e]/gu, "") : "";
    if (callValueAtomic !== "0" && result.code === "CONTRACT_VALIDATE_ERROR" &&
        /Validate InternalTransfer error, (?:no OwnerAccount|balance is not sufficient)\./u.test(message)) {
        throw new ApnError("APN_INSUFFICIENT_ASSET", "The owner TRON account cannot fund the exact SunSwap call value.", { reason: /no OwnerAccount/u.test(message) ? "sunswap_owner_not_activated" : "sunswap_owner_trx_insufficient" });
    }
    throw new ApnError("APN_OPERATION_BLOCKED", "TRON rejected the exact SunSwap constant call before execution.", { reason: "sunswap_constant_call_rejected" });
}
function reverted(resultHex) {
    let revertReason = "";
    if (/^08c379a0(?:[a-f0-9]{64}){2}/u.test(resultHex)) {
        const length = Number.parseInt(resultHex.slice(72, 136), 16);
        if (Number.isSafeInteger(length) && length > 0 && length <= 160 && resultHex.length >= 136 + length * 2) {
            revertReason = Buffer.from(resultHex.slice(136, 136 + length * 2), "hex").toString("latin1").replace(/[^\x20-\x7e]/gu, "");
        }
    }
    const reason = revertReason === "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT" ? "sunswap_output_below_minimum" :
        revertReason === "UniswapV2Router: EXPIRED" ? "sunswap_deadline_expired" : "sunswap_constant_call_reverted";
    throw new ApnError("APN_OPERATION_BLOCKED", "The exact SunSwap constant call reverted.", { reason, ...(revertReason === "" ? {} : { revertReason }) });
}
function unavailable(error) {
    if (error instanceof ApnError && (error.code === "APN_RPC_CONFIG" || error.code === "APN_RPC_PROTOCOL"))
        throw error;
    throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON read did not return valid SunSwap evidence.");
}
function invalid() { throw new ApnError("APN_INVALID_INPUT", "SunSwap constant call input is not canonical."); }
function protocol() { throw new ApnError("APN_RPC_PROTOCOL", "TRON returned SunSwap evidence with an invalid shape or binding."); }
//# sourceMappingURL=tron-call.js.map