import { decodeAbiParameters, getAddress, toEventSelector } from "viem";
import { USDT_GASLESS, usdtFailure } from "./model.js";
const USER_OPERATION_EVENT = toEventSelector("UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const TRANSFER = toEventSelector("Transfer(address indexed from, address indexed to, uint256 value)");
/** A failed UserOperationEvent in a successful, canonical EntryPoint transaction proves no account effect. */
export function verifyUsdtRevert(sender, userOpHash, receipt) {
    if (receipt.status !== "success")
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_revert_outer_status");
    const events = receipt.logs.filter(log => same(log.address, USDT_GASLESS.entryPoint) && log.topics[0] === USER_OPERATION_EVENT);
    const ours = events.filter(log => log.topics[1]?.toLowerCase() === userOpHash.toLowerCase());
    if (ours.length !== 1 || topicAddress(ours[0].topics[2]) !== sender ||
        topicAddress(ours[0].topics[3]) !== USDT_GASLESS.paymaster) {
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_revert_user_operation");
    }
    let success;
    try {
        [, success] = decodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], ours[0].data);
    }
    catch {
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_revert_event_data");
    }
    if (success)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_revert_success_event");
    if (receipt.logs.some(log => same(log.address, USDT_GASLESS.token) && log.topics[0] === TRANSFER &&
        topicAddress(log.topics[1]) === sender))
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_revert_token_debit");
}
/**
 * A receipt proves the payment only with exactly one successful UserOperationEvent for this hash, sender and paymaster,
 * exactly one USDT debit to the recipient of N, exactly one USDT debit to the treasury of A <= F, and no other USDT
 * leaving the sender in that transaction. Anything else is ambiguous and never closes the operation.
 */
export function verifyUsdtReceipt(plan, userOpHash, receipt) {
    if (receipt.status !== "success")
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_outer_reverted");
    const sender = plan.request.sender;
    const events = receipt.logs.filter((log) => same(log.address, USDT_GASLESS.entryPoint) && log.topics[0] === USER_OPERATION_EVENT);
    const ours = events.filter((log) => log.topics[1]?.toLowerCase() === userOpHash.toLowerCase());
    if (ours.length !== 1 || ours[0].topics[1]?.toLowerCase() !== userOpHash.toLowerCase()) {
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_user_operation");
    }
    const event = ours[0];
    if (topicAddress(event.topics[2]) !== sender)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_sender");
    if (topicAddress(event.topics[3]) !== USDT_GASLESS.paymaster)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_paymaster");
    const [, success, actualGasCost] = decodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], event.data);
    if (!success)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_user_operation_failed");
    const debits = receipt.logs.filter((log) => same(log.address, USDT_GASLESS.token) && log.topics[0] === TRANSFER &&
        topicAddress(log.topics[1]) === sender).map((log) => ({ to: topicAddress(log.topics[2]), value: BigInt(log.data) }));
    const delivery = debits.filter((debit) => debit.to === plan.request.recipient);
    const fee = debits.filter((debit) => debit.to === USDT_GASLESS.treasury);
    if (debits.length !== 2 || delivery.length !== 1 || fee.length !== 1)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_transfers");
    if (delivery[0].value !== plan.netAtomic)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_delivery_amount");
    const charged = fee[0].value;
    if (charged === 0n || charged > plan.feeCapAtomic)
        usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_fee_amount");
    return { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), userOpHash,
        senderDebitAtomic: (plan.netAtomic + charged).toString(), feeAtomic: charged.toString(),
        recipientCreditAtomic: plan.netAtomic.toString(), residualAllowanceAtomic: (plan.feeCapAtomic - charged).toString(),
        actualGasCostWei: actualGasCost.toString() };
}
function topicAddress(topic) {
    if (topic === undefined || !/^0x0{24}[0-9a-fA-F]{40}$/u.test(topic))
        return null;
    return getAddress(`0x${topic.slice(26)}`);
}
function same(a, b) { return a.toLowerCase() === b.toLowerCase(); }
//# sourceMappingURL=receipt.js.map