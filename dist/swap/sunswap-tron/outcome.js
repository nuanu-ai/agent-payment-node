import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronHex } from "../../tron/codec.js";
import { validateSwapOperation } from "../model.js";
import { SUNSWAP_V2_ROUTER } from "./catalog.js";
import { validateSunSwapPreparedMaterial } from "./prepared.js";
import { validateSunSwapReceipt } from "./receipt.js";
import { normalizeTronEvidence } from "./tron-call.js";
import { proveTronUnlanded } from "../unlanded.js";
/** Failed contract results TRON records in a block: state, including the call value, is rolled back and only fees burn. */
const FAILED_RESULTS = new Set(["REVERT", "BAD_JUMP_DESTINATION", "OUT_OF_MEMORY", "PRECOMPILED_CONTRACT", "STACK_TOO_SMALL",
    "STACK_TOO_LARGE", "ILLEGAL_OPERATION", "STACK_OVERFLOW", "OUT_OF_ENERGY", "OUT_OF_TIME", "JVM_STACK_OVER_FLOW",
    "TRANSFER_FAILED", "INVALID_CODE"]);
/**
 * Observe-only outcome reader for the exact prepared transaction. Null means not yet solidified. Success needs the
 * full receipt proof; a failed contract result needs the same transaction bytes, fee bounds and no emitted logs, from
 * both full-node and solidified history.
 */
export class SunSwapOutcomeObserver {
    rpc;
    now;
    constructor(rpc, now) {
        this.rpc = rpc;
        this.now = now;
    }
    async observeOutcome(operationValue, materialValue) {
        const operation = validateSwapOperation(operationValue), material = validateSunSwapPreparedMaterial(materialValue, "stored");
        if (operation.submissionMarker === null || material.quote.quoteHash !== operation.quote.quoteHash) {
            blocked("SunSwap observation is forbidden before the durable submission marker.");
        }
        const txid = material.execution.transaction.txID;
        let fullTx, fullInfo, solidTx, solidInfo, head;
        try {
            [fullTx, fullInfo, solidTx, solidInfo, head] = await Promise.all([
                this.rpc.call("wallet/gettransactionbyid", { value: txid }), this.rpc.call("wallet/gettransactioninfobyid", { value: txid }),
                this.rpc.call("walletsolidity/gettransactionbyid", { value: txid }), this.rpc.call("walletsolidity/gettransactioninfobyid", { value: txid }),
                this.rpc.call("walletsolidity/getnowblock", {}),
            ]);
        }
        catch {
            return conflict();
        }
        if (empty(solidTx) || empty(solidInfo))
            return null;
        const expected = expectation(operation, material);
        const solid = solidHead(head), succeeded = contractResult(solidTx) === "SUCCESS";
        const validate = succeeded ? validateSunSwapReceipt : validateSunSwapFailure;
        const full = validate(fullTx, fullInfo, solid, expected), finalized = validate(solidTx, solidInfo, solid, expected);
        if (full.receiptHash !== finalized.receiptHash)
            conflict();
        const observedAt = this.now();
        if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
            conflict();
        return { outcome: succeeded ? "succeeded" : "reverted", proof: { receiptHash: finalized.receiptHash,
                transactionHash: txid, observedAt: observedAt.toISOString(), finalized: true, economics: economicsOf(finalized) } };
    }
    /** One read of a swap its record proved solidified: the solidified transaction, its info and the head (observe only). */
    async receiptEconomics(operationValue, materialValue) {
        const operation = validateSwapOperation(operationValue), material = validateSunSwapPreparedMaterial(materialValue, "stored");
        const txid = material.execution.transaction.txID;
        if (operation.receiptProof?.transactionHash !== txid || material.quote.quoteHash !== operation.quote.quoteHash)
            factsBinding();
        let tx, info, head;
        try {
            [tx, info, head] = await Promise.all([this.rpc.call("walletsolidity/gettransactionbyid", { value: txid }),
                this.rpc.call("walletsolidity/gettransactioninfobyid", { value: txid }), this.rpc.call("walletsolidity/getnowblock", {})]);
        }
        catch {
            return conflict();
        }
        if (empty(tx) || empty(info))
            factsBinding();
        return sunSwapEconomicsFromSolidified(operation.state, tx, info, solidHead(head), expectation(operation, material));
    }
    /** Expiration passed at the solidified head and no solidified record of the exact transaction id. */
    async proveUnlanded(materialValue) {
        const material = validateSunSwapPreparedMaterial(materialValue, "stored");
        return await proveTronUnlanded(this.rpc, { transactionId: material.execution.transaction.txID,
            expirationMs: material.execution.intent.expirationMs });
    }
}
/** The economics of a solidified record already proven as this outcome, by the same validators that finalized it. */
export function sunSwapEconomicsFromSolidified(state, transaction, info, solidifiedHeadNumber, expected) {
    const succeeded = contractResult(transaction) === "SUCCESS";
    if (succeeded !== (state === "finalized") || !["finalized", "failed_confirmed_revert"].includes(state))
        factsBinding();
    return economicsOf((succeeded ? validateSunSwapReceipt : validateSunSwapFailure)(transaction, info, solidifiedHeadNumber, expected));
}
/** The solidified record's own amounts: call value in, USDT Transfer out, energy plus bandwidth fee burned (SUN). */
function economicsOf(v) {
    return { inputAtomic: v.inputAmountAtomic, outputAtomic: v.outputAmountAtomic, networkFeeAtomic: v.feeSun, nativeDebitAtomic: v.trxDebitSun };
}
function expectation(operation, material) {
    return { transactionHash: material.execution.transaction.txID, recipient: operation.quote.recipient,
        inputAmountAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
        unsignedRawDataHex: material.execution.transaction.raw_data_hex, maximumFeeSun: material.execution.intent.feeLimitSun,
        maximumBandwidthFeeSun: required(material.gasOrEnergy.maximumBandwidthFeeSun) };
}
function factsBinding() {
    throw new ApnError("APN_RPC_PROTOCOL", "The solidified record read for the swap economics is not the one this record proved.", { reason: "receipt_facts_binding" });
}
/** A solidified failed call: exact bytes, one failed result on both records, fees within the frozen bounds, no logs. */
export function validateSunSwapFailure(transactionValue, infoValue, solidifiedHeadNumber, expected) {
    const transaction = record(transactionValue), info = record(infoValue), ret = transaction.ret;
    if (transaction.txID !== expected.transactionHash || transaction.raw_data_hex !== expected.unsignedRawDataHex || !Array.isArray(ret) ||
        ret.length !== 1 || !isPlainRecord(ret[0]) || typeof ret[0].contractRet !== "string" || !FAILED_RESULTS.has(ret[0].contractRet) ||
        info.id !== expected.transactionHash || info.result !== "FAILED")
        conflict();
    const result = ret[0].contractRet, receipt = record(info.receipt);
    const contracts = record(transaction.raw_data).contract;
    if (receipt.result !== result || !Array.isArray(contracts) || contracts.length !== 1)
        conflict();
    const call = record(record(record(contracts[0]).parameter).value);
    if (call.owner_address !== tronHex(expected.recipient) || call.contract_address !== tronHex(SUNSWAP_V2_ROUTER) ||
        integer(call.call_value).toString() !== expected.inputAmountAtomic)
        conflict();
    if (info.log !== undefined && (!Array.isArray(info.log) || info.log.length !== 0))
        conflict();
    const block = integer(info.blockNumber), solid = integer(solidifiedHeadNumber), fee = optional(info.fee);
    const energyFee = optional(receipt.energy_fee), bandwidthFee = optional(receipt.net_fee);
    if (block <= 0n || solid < block || fee !== energyFee + bandwidthFee || energyFee > BigInt(expected.maximumFeeSun) ||
        bandwidthFee > BigInt(expected.maximumBandwidthFeeSun))
        conflict();
    const body = { transactionHash: expected.transactionHash, blockNumber: block.toString(), solidifiedHeadNumber: solid.toString(),
        contractResult: result, inputAmountAtomic: "0", feeSun: fee.toString(), trxDebitSun: fee.toString(), finalized: true };
    return { receiptHash: domainHash("apn.sunswap-tron-v2-failed-call.v1", canonicalJson(normalizeTronEvidence({ transaction, info, ...body }))),
        inputAmountAtomic: body.inputAmountAtomic, outputAmountAtomic: null, feeSun: body.feeSun, trxDebitSun: body.trxDebitSun };
}
function contractResult(value) {
    const ret = record(value).ret;
    return Array.isArray(ret) && ret.length === 1 && isPlainRecord(ret[0]) ? ret[0].contractRet : conflict();
}
function empty(value) { return isPlainRecord(value) && Object.keys(value).length === 0; }
function solidHead(value) {
    const number = record(record(record(value).block_header).raw_data).number;
    return integer(number).toString();
}
function required(value) { if (value === undefined)
    conflict(); return value; }
function record(value) { if (!isPlainRecord(value))
    conflict(); return value; }
function optional(value) { return value === undefined ? 0n : integer(value); }
function integer(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value))
        conflict();
    if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || !/^[0-9]+$/u.test(String(value)))
        conflict();
    return BigInt(value);
}
function conflict() { throw new ApnError("APN_RPC_PROTOCOL", "SunSwap full-node and solidified history is missing, conflicting, or not finalized."); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "sunswap_observation_before_marker" }); }
//# sourceMappingURL=outcome.js.map