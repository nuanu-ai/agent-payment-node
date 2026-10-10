import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { attributePermit2DirectTransaction, permit2FactHash, permit2FactQuantity, snapshotPermit2DirectTransaction } from "./production-proxy-call.js";
import { ERC20_TRANSFER_TOPIC, PROXY_SETTLED_TOPIC, PROXY_SETTLED_WITH_PERMIT_TOPIC } from "./registry.js";
/** Exact projected receipt facts. Never a settlement/failure finalizer or a chain-finality proof. */
export async function inspectPermit2ProductionReceipt(record, signed, transaction, value) {
    transaction = snapshotPermit2DirectTransaction(transaction);
    const receipt = snapshotReceipt(value);
    const attribution = await attributePermit2DirectTransaction(record, signed, transaction);
    if (receipt.transactionHash !== attribution.transactionHash || receipt.blockHash !== attribution.blockHash ||
        BigInt(receipt.blockNumber).toString() !== attribution.blockNumber)
        fail();
    const logs = receipt.logs;
    if (receipt.status === "0x0") {
        if (logs.length !== 0)
            fail();
        return { attribution, receiptStatus: "reverted_locator", transferLogIndex: null, settledLogIndex: null,
            finality: "not_checked", terminalAuthority: "none" };
    }
    const token = attribution.transfer.token.toLowerCase(), proxy = attribution.proxy.toLowerCase();
    const transfers = logs.filter(log => log.address.toLowerCase() === token && log.topics[0] === ERC20_TRANSFER_TOPIC);
    const settled = logs.filter(log => log.address.toLowerCase() === proxy &&
        (log.topics[0] === PROXY_SETTLED_TOPIC || log.topics[0] === PROXY_SETTLED_WITH_PERMIT_TOPIC));
    const transfer = transfers[0], event = settled[0];
    if (transfers.length !== 1 || settled.length !== 1 || !transfer || !event || transfer.topics.length !== 3 ||
        transfer.topics[1] !== addressTopic(attribution.transfer.from) || transfer.topics[2] !== addressTopic(attribution.transfer.to) ||
        transfer.data !== `0x${BigInt(attribution.transfer.amountAtomic).toString(16).padStart(64, "0")}` ||
        event.topics.length !== 1 || event.topics[0] !== attribution.settledTopic || event.data !== "0x" ||
        BigInt(transfer.logIndex) >= BigInt(event.logIndex))
        fail();
    return { attribution, receiptStatus: "succeeded", transferLogIndex: BigInt(transfer.logIndex).toString(),
        settledLogIndex: BigInt(event.logIndex).toString(), finality: "not_checked", terminalAuthority: "none" };
}
/** Deeply own receipt/log/topic projections before any asynchronous attribution. */
function snapshotReceipt(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["transactionHash", "blockHash", "blockNumber", "status", "logs"]))
        fail();
    value = { transactionHash: value.transactionHash, blockHash: value.blockHash, blockNumber: value.blockNumber,
        status: value.status, logs: value.logs };
    if (!isPlainRecord(value) || !permit2FactHash(value.transactionHash) || !permit2FactHash(value.blockHash) ||
        !permit2FactQuantity(value.blockNumber) || !["0x0", "0x1"].includes(value.status) ||
        !Array.isArray(value.logs) || value.logs.length > 4096)
        fail();
    const logs = [];
    let previous = -1n;
    for (const log of value.logs) {
        if (!isPlainRecord(log) || !exactKeys(log, ["address", "topics", "data", "logIndex", "transactionHash", "blockHash", "blockNumber", "removed"]) ||
            typeof log.address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(log.address) || !Array.isArray(log.topics) ||
            log.topics.length > 4 || log.topics.some(topic => typeof topic !== "string" || !/^0x[a-f0-9]{64}$/u.test(topic)) ||
            typeof log.data !== "string" || !/^0x(?:[a-f0-9]{2})*$/u.test(log.data) || log.data.length > 131074 ||
            !permit2FactQuantity(log.logIndex) || BigInt(log.logIndex) <= previous || log.removed !== false ||
            log.transactionHash !== value.transactionHash || log.blockHash !== value.blockHash || log.blockNumber !== value.blockNumber)
            fail();
        previous = BigInt(log.logIndex);
        logs.push(Object.freeze({ ...log, topics: Object.freeze([...log.topics]) }));
    }
    return Object.freeze({ transactionHash: value.transactionHash, blockHash: value.blockHash,
        blockNumber: value.blockNumber, status: value.status, logs: Object.freeze(logs) });
}
function addressTopic(value) { return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`; }
function fail() { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Receipt does not match the frozen direct Permit2 transaction."); }
//# sourceMappingURL=production-receipt-facts.js.map