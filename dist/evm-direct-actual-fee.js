import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { directEvmChain, directEvmNetwork } from "./evm-direct-networks.js";
/**
 * The receipt fields that carry a direct transfer's charge, exactly as the node answered them. A field the node did not
 * send stays absent; a value that is not a short string is kept as "invalid" so the derivation below stays reproducible.
 */
export const EVM_RECEIPT_FEE_FIELDS = ["gasUsed", "effectiveGasPrice", "l1Fee", "operatorFeeScalar", "operatorFeeConstant",
    "operatorFee", "blobGasUsed", "blobGasPrice"];
export function readEvmReceiptFeeFields(receipt) {
    const fields = {};
    for (const name of EVM_RECEIPT_FEE_FIELDS) {
        const value = receipt[name];
        if (value === undefined || value === null)
            continue;
        fields[name] = typeof value === "string" && value.length <= 66 ? value : "invalid";
    }
    return fields;
}
const FEE_MODELS = ["eip1559", "op-stack", "arbitrum-inclusive", "monad-gas-limit"];
/** A new observation names the network's current charge rule; a stored one is re-derived by the rule it names (R2). */
export function deriveEvmActualFee(input, feeModel) {
    const chainId = input.chainId;
    const base = { schemaVersion: "apn.evm-direct-actual-fee.v1", chainId, feeModel, transactionHash: input.transactionHash,
        blockNumberAtomic: input.blockNumberAtomic, gasLimitAtomic: input.gasLimitAtomic, maxFeePerGasAtomic: input.maxFeePerGasAtomic,
        receiptFields: input.receiptFields };
    const incomplete = (reason) => ({ ...base, complete: false, incompleteReason: reason, gasBilledAtomic: null,
        executionFeeAtomic: null, l1DataFeeAtomic: null, operatorFeeAtomic: null, totalFeeAtomic: null });
    const parsed = {};
    for (const [name, raw] of Object.entries(input.receiptFields)) {
        if (!/^0x[0-9a-fA-F]{1,64}$/u.test(raw))
            return incomplete("receipt_fee_field_malformed");
        parsed[name] = BigInt(raw);
    }
    const { gasUsed, effectiveGasPrice: price } = parsed, gasLimit = BigInt(input.gasLimitAtomic);
    if (gasUsed === undefined || price === undefined)
        return incomplete("receipt_execution_fee_fields_unavailable");
    if (gasUsed > gasLimit || price > BigInt(input.maxFeePerGasAtomic))
        return incomplete("receipt_fee_fields_contradict_signed_transaction");
    if ((parsed.blobGasUsed ?? 0n) !== 0n)
        return incomplete("receipt_blob_fee_unmodeled");
    const billed = feeModel === "monad-gas-limit" ? gasLimit : gasUsed, execution = billed * price;
    const complete = (l1, operator) => ({ ...base, complete: true, incompleteReason: null,
        gasBilledAtomic: billed.toString(), executionFeeAtomic: execution.toString(), l1DataFeeAtomic: l1?.toString() ?? null,
        operatorFeeAtomic: operator?.toString() ?? null, totalFeeAtomic: (execution + (l1 ?? 0n) + (operator ?? 0n)).toString() });
    if (feeModel !== "op-stack") {
        // Execution-only, Arbitrum (L1 posting inside gasUsed) and Monad (gas limit billed) networks charge nothing else.
        return [parsed.l1Fee, parsed.operatorFee, parsed.operatorFeeScalar, parsed.operatorFeeConstant].some(x => (x ?? 0n) !== 0n)
            ? incomplete("receipt_fee_component_unmodeled") : complete(null, null);
    }
    // OP stack: execution plus the receipt's own L1 data fee plus the operator fee (Jovian: gasUsed x scalar x 100 + constant);
    // absent operator fields are zero parameters, a scalar without its constant or a contradicting operatorFee is not a fee.
    const { l1Fee: l1, operatorFeeScalar: scalar, operatorFeeConstant: constant, operatorFee: reported } = parsed;
    if (l1 === undefined)
        return incomplete("op_l1_fee_unavailable");
    if ((scalar === undefined) !== (constant === undefined) || (scalar ?? 0n) > 0xffffffffn || (constant ?? 0n) > 0xffffffffffffffffn) {
        return incomplete("op_operator_fee_fields_inconsistent");
    }
    const derived = gasUsed * (scalar ?? 0n) * 100n + (constant ?? 0n), operator = reported ?? derived;
    return scalar !== undefined && operator !== derived ? incomplete("op_operator_fee_fields_inconsistent") : complete(l1, operator);
}
/** A stored fee observation must be exactly what its own receipt fields derive (R2: no current constant is consulted). */
export function validateEvmActualFee(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "chainId", "feeModel", "transactionHash", "blockNumberAtomic", "gasLimitAtomic",
        "maxFeePerGasAtomic", "receiptFields", "complete", "incompleteReason", "gasBilledAtomic", "executionFeeAtomic", "l1DataFeeAtomic",
        "operatorFeeAtomic", "totalFeeAtomic"]) || value.schemaVersion !== "apn.evm-direct-actual-fee.v1" ||
        !Number.isSafeInteger(value.chainId) || !FEE_MODELS.includes(value.feeModel) ||
        typeof value.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(value.transactionHash) ||
        ![value.blockNumberAtomic, value.gasLimitAtomic, value.maxFeePerGasAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]{0,77})$/u.test(x)) ||
        !isPlainRecord(value.receiptFields) || Object.entries(value.receiptFields).some(([name, field]) => !EVM_RECEIPT_FEE_FIELDS.includes(name) || typeof field !== "string" || field.length > 66))
        corrupt();
    let derived;
    try {
        derived = deriveEvmActualFee(value, value.feeModel);
    }
    catch {
        return corrupt();
    }
    if (canonicalJson(derived) !== canonicalJson(value))
        corrupt();
    return derived;
}
/** Only a local transfer's proven outcomes carry it, and only for this operation's own signed transaction. */
export function assertEvmActualFeeBinding(operation) {
    const fee = operation.evmActualFee;
    if (fee === undefined)
        return;
    const proven = validateEvmActualFee(fee);
    if (operation.providerDirect !== undefined || operation.economics === undefined || !["completed", "failed_confirmed_revert"].includes(operation.state) ||
        proven.chainId !== operation.chainId || proven.transactionHash !== operation.transactionHash?.toLowerCase() ||
        proven.gasLimitAtomic !== operation.economics.gasLimitAtomic || proven.maxFeePerGasAtomic !== operation.economics.maxFeePerGasAtomic)
        corrupt();
}
/** Public form: the fact when complete, its known parts and reason when not, null when nothing was observed. */
export function publicEvmActualFee(fee, asset, amountAtomic, state) {
    if (fee === undefined)
        return { actual_network_fee: null, actual_sender_native_debit_atomic: null };
    const network = directEvmNetwork(directEvmChain(fee.chainId));
    // The transfer value leaves the sender only when the native transfer succeeded; a revert charged the fee alone.
    const value = asset?.kind === "native" && state === "completed" ? BigInt(amountAtomic) : 0n;
    return {
        actual_network_fee: { status: fee.complete ? "complete" : "incomplete", chain: network.caip2, unit: network.nativeSymbol,
            decimals: network.nativeDecimals, fee_model: fee.feeModel, total_atomic: fee.totalFeeAtomic, execution_atomic: fee.executionFeeAtomic,
            l1_data_atomic: fee.l1DataFeeAtomic, operator_atomic: fee.operatorFeeAtomic, gas_billed_atomic: fee.gasBilledAtomic,
            effective_gas_price_atomic: fee.complete ? BigInt(fee.receiptFields.effectiveGasPrice).toString() : null,
            incomplete_reason: fee.incompleteReason, transaction_hash: fee.transactionHash, block_number_atomic: fee.blockNumberAtomic },
        actual_sender_native_debit_atomic: fee.totalFeeAtomic === null ? null : (value + BigInt(fee.totalFeeAtomic)).toString(),
    };
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Direct transfer actual fee does not match its own receipt fields."); }
//# sourceMappingURL=evm-direct-actual-fee.js.map