/** Circle V2 BaseTokenMessenger._mintAndWithdraw: net mint, optional issuer mint, then aggregate event.
 * All inputs remain public observations; the caller must authenticate the historical feeRecipient getter. */
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, toEventSelector } from "viem";
import { CIRCLE_AMOUNT, CIRCLE_MESSENGER, CIRCLE_RECIPIENT, circleRoute } from "./catalog.js";
import { circleFail, circleHex, circleRecord, circleUint } from "./protocol.js";
const ABI = parseAbi([
    "event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken,uint256 feeCollected)",
    "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const OLD_MINT = toEventSelector("MintAndWithdraw(address,uint256,address)");
const ZERO = getAddress(`0x${"0".repeat(40)}`);
function decode(log, name) {
    const event = ABI.find(x => x.name === name), topics = log.topics.map(x => circleHex(x, 32));
    const data = circleHex(log.data), decoded = decodeEventLog({ abi: [event], data, topics, strict: true });
    const args = decoded.args, unindexed = event.inputs.filter(x => !("indexed" in x && x.indexed));
    const canonical = encodeEventTopics({ abi: [event], eventName: name, args: args });
    if (canonical.length !== topics.length || canonical.some((x, i) => x !== topics[i]) ||
        encodeAbiParameters(unindexed, unindexed.map(x => args[x.name])).toLowerCase() !== data)
        circleFail("noncanonical_mint_event");
    return { args, index: circleUint(log.logIndex) };
}
export function decodeCircleMintEvents(attested, observation, feeRecipient) {
    const token = circleRoute(attested.destinationChain).token, fee = BigInt(attested.feeExecutedAtomic), net = BigInt(attested.receivedAtomic);
    if (fee + net !== CIRCLE_AMOUNT)
        circleFail("mint_conservation");
    const logs = circleRecord(observation.receipt).logs.map(circleRecord);
    const mintSelector = toEventSelector(ABI[0]), transferSelector = toEventSelector(ABI[1]);
    const mints = logs.filter(l => Array.isArray(l.topics) && [mintSelector, OLD_MINT].includes(circleHex(l.topics[0], 32)));
    if (mints.length !== 1 || getAddress(String(mints[0].address)) !== CIRCLE_MESSENGER || circleHex(mints[0].topics[0], 32) !== mintSelector)
        circleFail("mint_event_count_or_version");
    const mint = decode(mints[0], "MintAndWithdraw");
    if (mint.args.mintRecipient !== CIRCLE_RECIPIENT || mint.args.mintToken !== token || mint.args.amount !== net || mint.args.feeCollected !== fee)
        circleFail("mint_event_binding");
    const transfers = logs.filter(l => Array.isArray(l.topics) && circleHex(l.topics[0], 32) === transferSelector);
    if (transfers.length !== (fee === 0n ? 1 : 2))
        circleFail("mint_transfer_count");
    const decoded = transfers.map(l => {
        if (getAddress(String(l.address)) !== token)
            circleFail("mint_transfer_token");
        return decode(l, "Transfer");
    }).sort((a, b) => a.index < b.index ? -1 : 1);
    const principal = decoded[0];
    if (principal.args.from !== ZERO || principal.args.to !== CIRCLE_RECIPIENT || principal.args.value !== net || principal.index >= mint.index)
        circleFail("mint_transfer_binding");
    if (fee > 0n) {
        if (feeRecipient === undefined || getAddress(feeRecipient) === ZERO)
            circleFail("mint_fee_recipient_required");
        const issuer = decoded[1];
        if (issuer.args.from !== ZERO || issuer.args.to !== getAddress(feeRecipient) || issuer.args.value !== fee || issuer.index <= principal.index || issuer.index >= mint.index)
            circleFail("mint_issuer_fee_binding");
    }
}
//# sourceMappingURL=mint-events.js.map