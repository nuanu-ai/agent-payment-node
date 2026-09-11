import { encodeAbiParameters } from "viem";
import { saFail } from "../reasons.js";
import { saRegistry } from "../registry.js";
import { SA_DELEGATION_TUPLE_PARAMETER, SA_INCREASED_SPENT_TOPIC, SA_REDEEMED_TOPIC, SA_TRANSFER_TOPIC, rpcAddress, rpcHex, rpcQuantity, topicAddress, twoWords } from "./abi.js";
/** Validate the full canonical receipt against the one exact child/root redemption and one USDC transfer. */
export function verifySmartAccountReceipt(intent, outerSender, redemption, logs) {
    const registry = saRegistry(8453), gross = BigInt(intent.request.grossAtomic);
    const exactTransfers = [], ownerOutflows = [];
    for (const log of logs) {
        if (log.topics.length === 3 && log.topics[0] === SA_TRANSFER_TOPIC &&
            topicAddress(log.topics[1]) === intent.binding.ownerAddress && log.data.length === 66) {
            const amount = BigInt(log.data);
            if (amount > 0n)
                ownerOutflows.push(log);
            if (log.address === registry.token.address && topicAddress(log.topics[2]) === intent.request.recipient &&
                amount === gross)
                exactTransfers.push(log);
        }
    }
    if (exactTransfers.length !== 1 || ownerOutflows.length !== 1 || ownerOutflows[0] !== exactTransfers[0]) {
        saFail("sa_gasless_evidence");
    }
    const managerEvents = logs.filter(log => log.address === registry.protocol.manager.address &&
        log.topics[0] === SA_REDEEMED_TOPIC);
    if (managerEvents.length !== 2)
        saFail("sa_gasless_evidence");
    const expectedData = [redemption.child, redemption.root].map(delegation => encodeAbiParameters([SA_DELEGATION_TUPLE_PARAMETER], [delegation]));
    const observedData = managerEvents.map(log => {
        if (log.topics.length !== 3 || topicAddress(log.topics[1]) !== intent.binding.ownerAddress ||
            topicAddress(log.topics[2]) !== outerSender)
            saFail("sa_gasless_evidence");
        return log.data;
    });
    if (expectedData.some(value => observedData.filter(observed => observed === value).length !== 1) ||
        observedData.some(value => !expectedData.includes(value)))
        saFail("sa_gasless_evidence");
    const spentEvents = logs.filter(log => log.address === registry.protocol.amount.address &&
        log.topics[0] === SA_INCREASED_SPENT_TOPIC);
    if (spentEvents.length !== 1)
        saFail("sa_gasless_evidence");
    const spent = spentEvents[0];
    if (spent.topics.length !== 4 || topicAddress(spent.topics[1]) !== registry.protocol.manager.address ||
        topicAddress(spent.topics[2]) !== outerSender || spent.topics[3] !== redemption.childDelegationHash) {
        saFail("sa_gasless_evidence");
    }
    const [limit, amount] = twoWords(spent.data);
    if (limit !== gross || amount !== gross)
        saFail("sa_gasless_evidence");
    return { debitAtomic: gross.toString(), deliveredAtomic: gross.toString(),
        transferIndexAtomic: exactTransfers[0].logIndexAtomic, childSpentIndexAtomic: spent.logIndexAtomic,
        redemptionIndexesAtomic: [managerEvents[0].logIndexAtomic, managerEvents[1].logIndexAtomic] };
}
export function verifyChildScanLog(value, intent, childHash, from, to) {
    const registry = saRegistry(8453), number = rpcQuantity(value.blockNumber);
    const topics = value.topics;
    if (rpcAddress(value.address) !== registry.protocol.amount.address || value.removed !== false ||
        number < from || number > to || !Array.isArray(topics) || topics.length !== 4 ||
        rpcHex(topics[0], 32, 32) !== SA_INCREASED_SPENT_TOPIC ||
        rpcHex(topics[1], 32, 32) !== addressTopic(registry.protocol.manager.address) ||
        rpcHex(topics[2], 32, 32) !== addressTopic(intent.provider.facilitatorAddresses[0]) ||
        rpcHex(topics[3], 32, 32) !== childHash)
        saFail("sa_gasless_evidence");
    twoWords(rpcHex(value.data, 64, 64));
    validateScanIdentity(value);
    return rpcHex(value.transactionHash, 32, 32);
}
export function verifyTransferScanLog(value, intent, from, to) {
    const registry = saRegistry(8453), number = rpcQuantity(value.blockNumber), topics = value.topics;
    if (rpcAddress(value.address) !== registry.token.address || value.removed !== false || number < from || number > to ||
        !Array.isArray(topics) || topics.length !== 3 || rpcHex(topics[0], 32, 32) !== SA_TRANSFER_TOPIC ||
        rpcHex(topics[1], 32, 32) !== addressTopic(intent.binding.ownerAddress) ||
        rpcHex(topics[2], 32, 32) !== addressTopic(intent.request.recipient))
        saFail("sa_gasless_evidence");
    const amount = BigInt(rpcHex(value.data, 32, 32));
    validateScanIdentity(value);
    return amount === BigInt(intent.request.grossAtomic) ? rpcHex(value.transactionHash, 32, 32) : null;
}
function validateScanIdentity(value) {
    rpcHex(value.blockHash, 32, 32);
    rpcQuantity(value.transactionIndex);
    rpcQuantity(value.logIndex);
}
function addressTopic(address) { return `0x${address.slice(2).padStart(64, "0")}`; }
//# sourceMappingURL=receipt.js.map