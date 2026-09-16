import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { decodeMayanBaseSolanaQuoteOffline } from "../../src/lifi/mayan-offline.js";
import { BASE_CCTP_V1_MESSAGE_TRANSMITTER, SOLANA_CCTP_V1_TOKEN_MESSENGER_MINTER, decodeMayanBaseSolanaSourceReceiptOffline } from "../../src/lifi/mayan-source-receipt.js";
import { bridgeEventsAbi } from "../../src/lifi/abi.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";

const quote = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/base-solana-mayan-mctp-quote-synthetic-20260916.json"), "utf8")) as Record<string, any>;
const binding = { sender: getAddress("0x000000000000000000000000000000000000dEaD"),
  solanaRecipient: "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj", sourceAmountAtomic: "100000000", maxFeeAtomic: "250000" };
const frozen = decodeMayanBaseSolanaQuoteOffline(quote, binding);
const hash = `0x${"12".repeat(32)}` as Hex;
const blockHash = `0x${"ab".repeat(32)}` as Hex;
const recipient = "0x780e9926403ab41b34744b51cfa59df95f51b46405a34cdb4358d99ae2ea56ca" as Hex;
const tokenMessenger = getAddress("0x1682Ae6375C4E4A97e4B583BC394c861A46D8962");
const word = (address: string): Hex => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
const part = (n: bigint, width: number): string => n.toString(16).padStart(width * 2, "0");
function base58Bytes(value: string): Hex {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}
const message = (amount = 99_750_000n): Hex => (`0x${part(0n, 4)}${part(6n, 4)}${part(5n, 4)}${part(42n, 8)}` +
  `${word(tokenMessenger).slice(2)}${base58Bytes(SOLANA_CCTP_V1_TOKEN_MESSENGER_MINTER).slice(2)}${BRIDGE_ZERO_WORD.slice(2)}` +
  `${part(0n, 4)}${word(frozen.sourceToken).slice(2)}${"cd".repeat(32)}${part(amount, 32)}${word(frozen.mayanProtocol).slice(2)}`) as Hex;
const cctpAbi = parseAbi(["event MessageSent(bytes message)"]);
const nonEvmAbi = parseAbi(["event BridgeToNonEVMChainBytes32(bytes32 indexed transactionId,uint256 indexed destinationChainId,bytes32 receiver)"]);
function fixture() {
  const tx = { chainId: 8453, hash, from: frozen.sender, to: BRIDGE_DIAMOND, input: quote.transactionRequest.data, value: "0x0" };
  const bridgeData = { transactionId: frozen.transactionId, bridge: "mayanMCTP", integrator: "lifi-api", referrer: BRIDGE_ZERO_ADDRESS,
    sendingAssetId: frozen.sourceToken, receiver: getAddress("0x11f111f111f111f111f111f111f111f111f111f1"),
    minAmount: BigInt(frozen.bridgeAmountAtomic), destinationChainId: 1151111081099710n, hasSourceSwaps: true, hasDestinationCall: false };
  const lifiItem = bridgeEventsAbi.find(item => item.type === "event" && item.name === "LiFiTransferStarted")!;
  const logs = [
    { address: BRIDGE_DIAMOND, topics: encodeEventTopics({ abi: [lifiItem], eventName: "LiFiTransferStarted" }),
      data: encodeAbiParameters(lifiItem.inputs, [bridgeData]) },
    { address: BRIDGE_DIAMOND, topics: encodeEventTopics({ abi: nonEvmAbi, eventName: "BridgeToNonEVMChainBytes32",
      args: { transactionId: frozen.transactionId, destinationChainId: 1151111081099710n } }),
      data: encodeAbiParameters([{ name: "receiver", type: "bytes32" }], [recipient]) },
    { address: BASE_CCTP_V1_MESSAGE_TRANSMITTER, topics: encodeEventTopics({ abi: cctpAbi, eventName: "MessageSent" }),
      data: encodeAbiParameters([{ name: "message", type: "bytes" }], [message()]) },
  ];
  return { tx, receipt: { chainId: 8453, transactionHash: hash, status: "0x1", blockHash, blockNumberAtomic: "123", logs } };
}
test("frozen Mayan quote and one canonical Base CCTP V1 message give source correlation only", () => {
  const { tx, receipt } = fixture();
  const result = decodeMayanBaseSolanaSourceReceiptOffline(quote, binding, tx, receipt);
  assert.equal(result.bridgeCompletion, false);
  assert.equal(result.sourceMessageCorrelation.bridgeCompletion, false);
  assert.equal(result.sourceMessageCorrelation.transactionId, frozen.transactionId);
  assert.equal(result.sourceMessageCorrelation.nonce, "42");
  assert.equal(result.sourceMessageCorrelation.burnAmountAtomic, "99750000");
  assert.equal(result.sourceMessageCorrelation.mintRecipient, `0x${"cd".repeat(32)}`);
  assert.equal(result.sourceMessageCorrelation.messageHash, keccak256(message()));
});
test("rejects wrong transaction identity, status, missing and duplicate Circle messages", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.tx.from = BRIDGE_ZERO_ADDRESS; },
    (f: ReturnType<typeof fixture>) => { f.tx.input = "0x"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.status = "0x0"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.transactionHash = BRIDGE_ZERO_WORD; },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs.pop(); },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs.push(f.receipt.logs[2]!); },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs[2]!.address = BRIDGE_DIAMOND; },
  ]) { const f = fixture(); change(f); assert.throws(() => decodeMayanBaseSolanaSourceReceiptOffline(quote, binding, f.tx, f.receipt), /mayan_source_/u); }
});
test("rejects malformed V1 body, mismatched Mayan burn and facet receiver", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.receipt.logs[2]!.data = "0x1234"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs[2]!.data = encodeAbiParameters([{ type: "bytes" }], [message(99_750_001n)]); },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs[1]!.data = encodeAbiParameters([{ type: "bytes32" }], [BRIDGE_ZERO_WORD]); },
  ]) { const f = fixture(); change(f); assert.throws(() => decodeMayanBaseSolanaSourceReceiptOffline(quote, binding, f.tx, f.receipt), /mayan_source_/u); }
});
