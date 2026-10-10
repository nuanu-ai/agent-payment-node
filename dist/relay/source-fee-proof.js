/** Full canonical receipt fee for the finite post-Jovian Base Relay lanes. */
import { ApnError } from "../errors.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
function invalid() { throw new ApnError("APN_RPC_PROTOCOL", "Base receipt fee evidence is invalid."); }
export function decodeRelayBaseReceiptFee(receipt) {
    const gas = evmRpcQuantity(receipt.gasUsed), price = evmRpcQuantity(receipt.effectiveGasPrice);
    const l1 = evmRpcQuantity(receipt.l1Fee);
    // OP-geth JSON fee extensions are QUANTITY, with uint32/uint64 protocol bounds.
    // daFootprintGasScalar is emitted only after Jovian: do not silently apply its formula to an older fork.
    evmRpcQuantity(receipt.daFootprintGasScalar);
    const scalar = receipt.operatorFeeScalar, constant = receipt.operatorFeeConstant;
    if ((scalar === undefined) !== (constant === undefined))
        invalid();
    const scalarValue = scalar === undefined ? 0n : evmRpcQuantity(scalar);
    const constantValue = constant === undefined ? 0n : evmRpcQuantity(constant);
    if (scalarValue > 0xffffffffn || constantValue > 0xffffffffffffffffn)
        invalid();
    const derived = gas * scalarValue * 100n + constantValue;
    const operator = receipt.operatorFee === undefined ? derived : evmRpcQuantity(receipt.operatorFee);
    if (scalar !== undefined && operator !== derived)
        invalid();
    const l2 = gas * price;
    return { l2ExecutionFeeWei: l2.toString(), l1FeeWei: l1.toString(), operatorFeeWei: operator.toString(), totalFeeWei: (l2 + l1 + operator).toString() };
}
export function verifyRelayBaseReceiptFee(fee, maximum) {
    const decimal = /^(0|[1-9][0-9]*)$/u;
    if (!fee || !Object.values(fee).every(value => typeof value === "string" && decimal.test(value)) ||
        Object.keys(fee).sort().join() !== "l1FeeWei,l2ExecutionFeeWei,operatorFeeWei,totalFeeWei" ||
        BigInt(fee.totalFeeWei) !== BigInt(fee.l2ExecutionFeeWei) + BigInt(fee.l1FeeWei) + BigInt(fee.operatorFeeWei) ||
        BigInt(fee.totalFeeWei) > BigInt(maximum))
        invalid();
}
//# sourceMappingURL=source-fee-proof.js.map