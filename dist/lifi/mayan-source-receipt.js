/** Offline source observation for the one frozen Base -> Solana Mayan MCTP quote shape. */
import { decodeEventLog, encodeAbiParameters, getAddress, keccak256, parseAbi, toEventSelector } from "viem";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint, BRIDGE_DIAMOND, BRIDGE_ZERO_WORD } from "./validation.js";
import { decodeMayanBaseSolanaQuoteOffline } from "./mayan-offline.js";
import { bridgeEventsAbi, EVENT_TOPICS } from "./abi.js";
/** Circle's published CCTP V1 Base mainnet deployments. */
export const BASE_CCTP_V1_MESSAGE_TRANSMITTER = getAddress("0xAD09780d193884d503182aD4588450C416D6F9D4");
export const BASE_CCTP_V1_TOKEN_MESSENGER = getAddress("0x1682Ae6375C4E4A97e4B583BC394c861A46D8962");
/** Circle's CCTP V1 Solana mainnet TokenMessengerMinter program. */
export const SOLANA_CCTP_V1_TOKEN_MESSENGER_MINTER = "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3";
const NON_EVM = getAddress("0x11f111f111f111f111f111f111f111f111f111f1");
const CCTP_ABI = parseAbi(["event MessageSent(bytes message)"]);
const NON_EVM_ABI = parseAbi(["event BridgeToNonEVMChainBytes32(bytes32 indexed transactionId,uint256 indexed destinationChainId,bytes32 receiver)"]);
const MESSAGE_TOPIC = toEventSelector(CCTP_ABI[0]);
const NON_EVM_TOPIC = toEventSelector(NON_EVM_ABI[0]);
function fail(reason) { return bridgeFailure("APN_RPC_PROTOCOL", `mayan_source_${reason}`); }
function wordAddress(word, reason) {
    if (!/^0x0{24}[0-9a-f]{40}$/u.test(word))
        fail(reason);
    return getAddress(`0x${word.slice(26)}`);
}
function bytes(value, start, length) { return `0x${value.slice(2 + start * 2, 2 + (start + length) * 2)}`; }
function integer(value) { return BigInt(value); }
function oneLog(logs, address, topic, reason) {
    const matches = logs.filter(log => log.address.toLowerCase() === address.toLowerCase() && log.topics[0]?.toLowerCase() === topic.toLowerCase());
    if (matches.length !== 1)
        fail(`${reason}_count`);
    return matches[0];
}
/** No RPC, provider, custody or execution dependency. Inputs must be obtained and authenticated by the caller. */
export function decodeMayanBaseSolanaSourceReceiptOffline(quoteValue, binding, transactionValue, receiptValue) {
    const quote = bridgeRecord(quoteValue), qtx = bridgeRecord(quote.transactionRequest);
    const frozen = decodeMayanBaseSolanaQuoteOffline(quoteValue, binding);
    const tx = bridgeRecord(transactionValue, "APN_RPC_PROTOCOL"), receipt = bridgeRecord(receiptValue, "APN_RPC_PROTOCOL");
    const hash = bridgeHex(tx.hash, 32, 32, "APN_RPC_PROTOCOL");
    if (hash === BRIDGE_ZERO_WORD || tx.chainId !== 8453 || receipt.chainId !== 8453 ||
        bridgeHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") !== hash || receipt.status !== "0x1" ||
        bridgeAddress(tx.from, "APN_RPC_PROTOCOL") !== frozen.sender || bridgeAddress(tx.to, "APN_RPC_PROTOCOL") !== BRIDGE_DIAMOND ||
        bridgeHex(tx.input, 12 * 1024, undefined, "APN_RPC_PROTOCOL") !== bridgeHex(qtx.data) ||
        tx.value !== "0x0")
        fail("transaction_binding");
    const blockHash = bridgeHex(receipt.blockHash, 32, 32, "APN_RPC_PROTOCOL");
    const blockNumberAtomic = bridgeUint(receipt.blockNumberAtomic, true, "APN_RPC_PROTOCOL").toString();
    if (blockHash === BRIDGE_ZERO_WORD || !Array.isArray(receipt.logs) || receipt.logs.length > 512)
        fail("receipt_shape");
    const logs = receipt.logs.map(value => {
        const log = bridgeRecord(value, "APN_RPC_PROTOCOL");
        if (!Array.isArray(log.topics) || log.topics.length > 4)
            fail("log_topics");
        return { address: bridgeAddress(log.address, "APN_RPC_PROTOCOL"),
            topics: log.topics.map(topic => bridgeHex(topic, 32, 32, "APN_RPC_PROTOCOL")),
            data: bridgeHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL") };
    });
    const lifi = oneLog(logs, BRIDGE_DIAMOND, EVENT_TOPICS.lifiTransferStarted, "lifi_event");
    const nonEvm = oneLog(logs, BRIDGE_DIAMOND, NON_EVM_TOPIC, "non_evm_event");
    let bridge, receiver, transactionId, destinationChainId;
    try {
        bridge = decodeEventLog({ abi: bridgeEventsAbi, eventName: "LiFiTransferStarted", data: lifi.data, topics: lifi.topics, strict: true }).args.bridgeData;
        const decoded = decodeEventLog({ abi: NON_EVM_ABI, eventName: "BridgeToNonEVMChainBytes32", data: nonEvm.data, topics: nonEvm.topics, strict: true });
        ({ receiver, transactionId, destinationChainId } = decoded.args);
    }
    catch {
        return fail("facet_event_decode");
    }
    const recipientBytes = `0x${Buffer.from(base58Bytes(frozen.solanaRecipient)).toString("hex")}`;
    if (bridge.transactionId !== frozen.transactionId || bridge.bridge !== "mayanMCTP" || bridge.integrator !== "lifi-api" ||
        bridge.referrer !== "0x0000000000000000000000000000000000000000" || bridge.sendingAssetId !== frozen.sourceToken ||
        bridge.receiver !== NON_EVM || bridge.minAmount !== BigInt(frozen.bridgeAmountAtomic) ||
        bridge.destinationChainId !== 1151111081099710n || bridge.hasSourceSwaps !== true || bridge.hasDestinationCall !== false ||
        transactionId !== frozen.transactionId || destinationChainId !== 1151111081099710n || receiver.toLowerCase() !== recipientBytes)
        fail("facet_event_binding");
    const cctp = oneLog(logs, BASE_CCTP_V1_MESSAGE_TRANSMITTER, MESSAGE_TOPIC, "cctp_message");
    if (cctp.topics.length !== 1)
        fail("cctp_topics");
    let message;
    try {
        message = decodeEventLog({ abi: CCTP_ABI, eventName: "MessageSent", data: cctp.data, topics: cctp.topics, strict: true }).args.message;
    }
    catch {
        return fail("cctp_decode");
    }
    message = bridgeHex(message, 12 * 1024, undefined, "APN_RPC_PROTOCOL");
    if (encodeAbiParameters([{ type: "bytes" }], [message]).toLowerCase() !== cctp.data.toLowerCase())
        fail("cctp_noncanonical_event");
    if (message.length !== 2 + 248 * 2 || integer(bytes(message, 0, 4)) !== 0n || integer(bytes(message, 4, 4)) !== 6n ||
        integer(bytes(message, 8, 4)) !== 5n || integer(bytes(message, 116, 4)) !== 0n)
        fail("cctp_v1_format");
    const nonce = integer(bytes(message, 12, 8));
    const sender = wordAddress(bytes(message, 20, 32), "cctp_sender");
    const burnToken = wordAddress(bytes(message, 120, 32), "cctp_burn_token");
    const mintRecipient = bytes(message, 152, 32);
    const amount = integer(bytes(message, 184, 32));
    const mayanSender = wordAddress(bytes(message, 216, 32), "cctp_message_sender");
    const destinationProgram = `0x${Buffer.from(base58Bytes(SOLANA_CCTP_V1_TOKEN_MESSENGER_MINTER)).toString("hex")}`;
    if (bytes(message, 52, 32) !== destinationProgram || sender !== BASE_CCTP_V1_TOKEN_MESSENGER ||
        burnToken !== frozen.sourceToken || mayanSender !== frozen.mayanProtocol ||
        amount === 0n || amount > BigInt(frozen.bridgeAmountAtomic) || mintRecipient === BRIDGE_ZERO_WORD)
        fail("cctp_burn_binding");
    return { kind: "offline_mayan_mctp_source_receipt", transactionHash: hash, blockHash, blockNumberAtomic,
        sourceMessageCorrelation: { kind: "cctp_v1_mayan_source_message", transactionId: frozen.transactionId, sourceDomain: 6,
            destinationDomain: 5, nonce: nonce.toString(), messageHash: keccak256(message), messageTransmitter: BASE_CCTP_V1_MESSAGE_TRANSMITTER,
            tokenMessenger: sender, mayanMessageSender: mayanSender, burnToken, burnAmountAtomic: amount.toString(), mintRecipient,
            destinationCaller: bytes(message, 84, 32), bridgeCompletion: false }, bridgeCompletion: false };
}
function base58Bytes(value) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n;
    for (const c of value)
        n = n * 58n + BigInt(alphabet.indexOf(c));
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
        out[i] = Number(n & 255n);
        n >>= 8n;
    }
    return out;
}
//# sourceMappingURL=mayan-source-receipt.js.map