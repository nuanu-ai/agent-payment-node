import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { validateSwapOperation } from "../model.js";
import { validateSunSwapExecutionBinding } from "./signer.js";
import { validateSunSwapReceipt } from "./receipt.js";
export class SunSwapSolidifiedObserver {
    rpc;
    expectedOperation;
    binding;
    maximumFeeSun;
    now;
    constructor(rpc, expectedOperation, binding, maximumFeeSun, now = () => new Date()) {
        this.rpc = rpc;
        this.expectedOperation = expectedOperation;
        this.binding = binding;
        this.maximumFeeSun = maximumFeeSun;
        this.now = now;
        validateSunSwapExecutionBinding(expectedOperation, binding);
        if (maximumFeeSun !== binding.intent.feeLimitSun)
            conflict();
    }
    async observe(operationValue) {
        const operation = validateSwapOperation(operationValue);
        if (operation.operationId !== this.expectedOperation.operationId ||
            validateSunSwapExecutionBinding(operation, this.binding) !== validateSunSwapExecutionBinding(this.expectedOperation, this.binding) ||
            operation.submissionMarker === null)
            conflict();
        const receipt = await observeSunSwapFinality(this.rpc, { transactionHash: this.binding.transaction.txID,
            recipient: operation.quote.recipient, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
            unsignedRawDataHex: this.binding.transaction.raw_data_hex, maximumFeeSun: this.maximumFeeSun });
        const observedAt = this.now();
        if (!Number.isFinite(observedAt.getTime()))
            conflict();
        return { receiptHash: receipt.receiptHash, transactionHash: receipt.transactionHash,
            observedAt: observedAt.toISOString(), finalized: true };
    }
}
export async function observeSunSwapFinality(rpc, expected) {
    let fullTransaction, fullInfo, solidTransaction, solidInfo, head;
    try {
        [fullTransaction, fullInfo, solidTransaction, solidInfo, head] = await Promise.all([
            rpc.call("wallet/gettransactionbyid", { value: expected.transactionHash }),
            rpc.call("wallet/gettransactioninfobyid", { value: expected.transactionHash }),
            rpc.call("walletsolidity/gettransactionbyid", { value: expected.transactionHash }),
            rpc.call("walletsolidity/gettransactioninfobyid", { value: expected.transactionHash }),
            rpc.call("walletsolidity/getnowblock", {}),
        ]);
    }
    catch {
        return conflict();
    }
    const solid = solidHead(head);
    const full = validateSunSwapReceipt(fullTransaction, fullInfo, solid, expected);
    const finalized = validateSunSwapReceipt(solidTransaction, solidInfo, solid, expected);
    const proof = (value) => ({ transactionHash: value.transactionHash, blockNumber: value.blockNumber,
        solidifiedHeadNumber: value.solidifiedHeadNumber, outputAmountAtomic: value.outputAmountAtomic, feeSun: value.feeSun,
        finalized: value.finalized });
    if (canonicalJson(proof(full)) !== canonicalJson(proof(finalized)))
        conflict();
    if (full.receiptHash !== finalized.receiptHash)
        conflict();
    return finalized;
}
function solidHead(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return conflict();
    const header = value.block_header;
    if (header === null || typeof header !== "object" || Array.isArray(header))
        return conflict();
    const raw = header.raw_data;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return conflict();
    const number = raw.number;
    if ((typeof number !== "string" && typeof number !== "number" && typeof number !== "bigint") || !/^[0-9]+$/u.test(String(number)))
        conflict();
    return String(number);
}
function conflict() { throw new ApnError("APN_RPC_PROTOCOL", "SunSwap full-node and solidified history is missing, conflicting, or not finalized."); }
//# sourceMappingURL=observer.js.map