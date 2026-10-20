import { formatEther } from "viem";
import { ApnError } from "../errors.js";
const wei = (value) => ({ wei: value.toString(), eth: formatEther(value) });
/**
 * A native debit the owner's cap or the wallet's ETH cannot cover, refused by name with its numbers and no provider text.
 * Callers check a known value before eth_estimateGas: a node answers an unfunded value with an error envelope (for
 * example -32003 OutOfFunds) that would otherwise read as an RPC configuration failure.
 */
export function stargateFundsRefusal(reason, parts) {
    const limitName = reason === "max_native_debit_exceeded" ? "max_native_debit" : "native_balance";
    const required = wei(parts.required), limit = wei(parts.limit);
    throw new ApnError("APN_OPERATION_BLOCKED", reason === "max_native_debit_exceeded"
        ? `The native debit ${required.eth} ETH exceeds the max native debit ${limit.eth} ETH.`
        : `The native debit ${required.eth} ETH exceeds the wallet's ETH balance ${limit.eth} ETH.`, {
        reason, required_wei: required.wei, required_eth: required.eth, [`${limitName}_wei`]: limit.wei, [`${limitName}_eth`]: limit.eth,
        ...(parts.principal === undefined ? {} : { principal_wei: parts.principal.toString() }),
        ...(parts.messagingFee === undefined ? {} : { messaging_fee_wei: parts.messagingFee.toString() }),
        gas_included: parts.gas !== undefined, ...(parts.gas === undefined ? {} : { gas_upper_wei: parts.gas.toString() }),
    });
}
//# sourceMappingURL=funds.js.map