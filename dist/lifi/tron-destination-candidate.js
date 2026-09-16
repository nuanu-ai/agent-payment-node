import { atomic } from "../chain-policy.js";
import { TRON_TRANSFER_TOPIC, TRON_USDT, TRON_USDT_HEX, tronAddress, tronArray, tronHash, tronHex, tronProtocolFailure, tronRecord } from "../tron/codec.js";
/** Parse a frozen pair of solidified TRON responses; this never completes a bridge operation. */
export function parseTronDestinationCandidate(input) {
    const transactionId = tronHash(input.transactionId);
    const recipient = tronAddress(input.recipient);
    let minimum;
    try {
        minimum = atomic(input.minimumOutputAtomic);
    }
    catch {
        return tronProtocolFailure();
    }
    if (minimum <= 0n || input.providerOutcome !== "completed")
        tronProtocolFailure();
    const transaction = tronRecord(input.transaction);
    const info = tronRecord(input.transactionInfo);
    if (transaction.txID !== transactionId || info.id !== transactionId)
        tronProtocolFailure();
    const rows = tronArray(transaction.ret, 1);
    if (rows.length !== 1)
        tronProtocolFailure();
    const result = tronRecord(rows[0]);
    // The transaction body's protobuf enum is spelled SUCESS; contractRet and VM receipt use SUCCESS.
    if (result.ret !== "SUCESS" && result.ret !== undefined && result.ret !== 0 || result.contractRet !== "SUCCESS")
        tronProtocolFailure();
    if (info.result !== undefined && info.result !== "SUCESS" && info.result !== 0)
        tronProtocolFailure();
    if (tronRecord(info.receipt).result !== "SUCCESS")
        tronProtocolFailure();
    const recipientHex = tronHex(recipient).slice(2);
    let delta = 0n;
    let matched = false;
    for (const raw of tronArray(info.log, 256)) {
        const log = tronRecord(raw);
        const topics = tronArray(log.topics, 4);
        if (typeof log.address !== "string" || !/^[a-f0-9]{40}$/u.test(log.address) ||
            topics.some((topic) => typeof topic !== "string" || !/^[a-f0-9]{64}$/u.test(topic)) ||
            typeof log.data !== "string" || !/^(?:[a-f0-9]{2})*$/u.test(log.data))
            tronProtocolFailure();
        if (log.address !== TRON_USDT_HEX.slice(2) || topics[0] !== TRON_TRANSFER_TOPIC)
            continue;
        if (topics.length !== 3 || !/^[0]{24}[a-f0-9]{40}$/u.test(topics[1]) ||
            !/^[0]{24}[a-f0-9]{40}$/u.test(topics[2]) || !/^[a-f0-9]{64}$/u.test(log.data))
            tronProtocolFailure();
        const from = topics[1].slice(24);
        const to = topics[2].slice(24);
        const amount = BigInt(`0x${log.data}`);
        if (to === recipientHex || from === recipientHex)
            matched = true;
        if (to === recipientHex)
            delta += amount;
        if (from === recipientHex)
            delta -= amount;
    }
    if (!matched || delta <= 0n || delta < minimum)
        tronProtocolFailure();
    return { proofClass: "tron_solidified_usdt_destination_candidate", transactionId, recipient, token: TRON_USDT,
        receivedAtomic: delta.toString(), minimumOutputAtomic: minimum.toString(), sourceMessageCorrelation: "unverified", bridgeCompletion: false };
}
//# sourceMappingURL=tron-destination-candidate.js.map