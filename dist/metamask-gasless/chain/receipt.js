import { mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { addressWord, MM_APPROVAL_TOPIC, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC, rpcAddress, rpcHex, rpcQuantity, topicAddress, twoWords } from "./abi.js";
/** Validate complete receipt logs against the exact one-root/two-USDC-call settlement. */
export function verifyMetaMaskReceiptAccounting(intent, outerSender, logs) {
    const row = mmRegistry(intent.request.chainId).row;
    const tokenLogs = logs.filter(log => log.address === row.token);
    const countLogs = logs.filter(log => log.address === row.protocol.limitedCalls.address);
    if (tokenLogs.length !== 2 || countLogs.length !== 1)
        mmFail("mm_gasless_evidence_invalid");
    for (const log of logs) {
        if (log.topics[0] === MM_TRANSFER_TOPIC && log.topics.length === 3 &&
            topicAddress(log.topics[1]) === intent.binding.address && log.address !== row.token) {
            mmFail("mm_gasless_evidence_invalid");
        }
        if (log.address === row.token && log.topics[0] === MM_APPROVAL_TOPIC && log.topics.length >= 2 &&
            topicAddress(log.topics[1]) === intent.binding.address)
            mmFail("mm_gasless_evidence_invalid");
    }
    const expectedRecipients = [intent.request.recipient, intent.quote.feeRecipient];
    const expectedAmounts = [intent.quote.netAtomic, intent.quote.feeAtomic];
    const transferIndexes = [];
    for (let index = 0; index < tokenLogs.length; index += 1) {
        const log = tokenLogs[index];
        if (log.topics.length !== 3 || log.topics[0] !== MM_TRANSFER_TOPIC || log.data.length !== 66 ||
            topicAddress(log.topics[1]) !== intent.binding.address ||
            topicAddress(log.topics[2]) !== expectedRecipients[index] ||
            BigInt(log.data).toString() !== expectedAmounts[index])
            mmFail("mm_gasless_evidence_invalid");
        transferIndexes.push(log.logIndexAtomic);
    }
    const count = countLogs[0];
    if (count.topics.length !== 4 || count.topics[0] !== MM_INCREASED_COUNT_TOPIC ||
        topicAddress(count.topics[1]) !== row.protocol.manager.address ||
        topicAddress(count.topics[2]) !== outerSender || count.topics[3] !== intent.delegationHash) {
        mmFail("mm_gasless_evidence_invalid");
    }
    const [limit, callCount] = twoWords(count.data);
    if (limit !== 1n || callCount !== 1n || BigInt(count.logIndexAtomic) >= BigInt(transferIndexes[0]) ||
        BigInt(transferIndexes[0]) >= BigInt(transferIndexes[1]))
        mmFail("mm_gasless_evidence_invalid");
    const delivered = BigInt(intent.quote.netAtomic), fee = BigInt(intent.quote.feeAtomic);
    if (delivered + fee !== BigInt(intent.request.grossAtomic))
        mmFail("mm_gasless_evidence_invalid");
    return { deliveredAtomic: delivered.toString(), feeAtomic: fee.toString(),
        debitAtomic: (delivered + fee).toString(), firstTransferIndexAtomic: transferIndexes[0],
        secondTransferIndexAtomic: transferIndexes[1], counterIndexAtomic: count.logIndexAtomic };
}
/** Validate one scan log before treating its transaction hash as a candidate. */
export function verifyScanLog(value, intent, from, to) {
    const row = mmRegistry(intent.request.chainId).row;
    const topics = value.topics;
    const number = rpcQuantity(value.blockNumber);
    if (rpcAddress(value.address) !== row.protocol.limitedCalls.address || value.removed !== false ||
        number < from || number > to || !Array.isArray(topics) || topics.length !== 4 ||
        rpcHex(topics[0], 32, 32) !== MM_INCREASED_COUNT_TOPIC ||
        rpcHex(topics[1], 32, 32) !== addressTopic(row.protocol.manager.address) ||
        rpcHex(topics[3], 32, 32) !== intent.delegationHash)
        mmFail("mm_gasless_evidence_invalid");
    topicAddress(rpcHex(topics[2], 32, 32));
    const data = rpcHex(value.data, 64, 64), [limit, count] = twoWords(data);
    if (limit !== 1n || count !== 1n)
        mmFail("mm_gasless_evidence_invalid");
    rpcHex(value.blockHash, 32, 32);
    rpcQuantity(value.logIndex);
    return rpcHex(value.transactionHash, 32, 32);
}
function addressTopic(address) { return addressWord(address); }
//# sourceMappingURL=receipt.js.map