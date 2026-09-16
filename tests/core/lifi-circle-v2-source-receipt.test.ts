import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { BASE_CCTP_V2_MESSAGE_TRANSMITTER, BASE_CCTP_V2_TOKEN_MESSENGER, BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, circleV2BurnTermsFromQuote, decodeCircleV2BaseSourceReceiptOffline, type CircleV2BurnIntent } from "../../src/lifi/circle-v2-source-receipt.js";
import { BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";

const sender = getAddress("0x000000000000000000000000000000000000dEaD");
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ata = `0x${"ab".repeat(32)}` as Hex;
const solanaMessenger = "0xa65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e93893" as Hex;
const hash = `0x${"12".repeat(32)}` as Hex;
const blockHash = `0x${"34".repeat(32)}` as Hex;
const intent: CircleV2BurnIntent = { sourceTransactionHash: hash, sourceFrom: sender, amountAtomic: "100000000", solanaAtaBytes32: ata,
  maxFeeAtomic: "500000", minFinalityThreshold: 1000, hookData: "0x" };
const burnAbi = parseAbi(["event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)"]);
const sentAbi = parseAbi(["event MessageSent(bytes message)"]);
const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
const n = (value: bigint, width: number) => value.toString(16).padStart(width * 2, "0");
function message(overrides: { amount?: bigint; ata?: Hex; headerSender?: Hex; bodySender?: Hex; nonce?: Hex; maxFee?: bigint; finality?: bigint; hook?: Hex } = {}): Hex {
  return (`0x${n(1n,4)}${n(6n,4)}${n(5n,4)}${(overrides.nonce ?? BRIDGE_ZERO_WORD).slice(2)}` +
    `${(overrides.headerSender ?? word(BASE_CCTP_V2_TOKEN_MESSENGER)).slice(2)}${solanaMessenger.slice(2)}${BRIDGE_ZERO_WORD.slice(2)}` +
    `${n(overrides.finality ?? 1000n,4)}${n(0n,4)}${n(1n,4)}${word(usdc).slice(2)}${(overrides.ata ?? ata).slice(2)}` +
    `${n(overrides.amount ?? 100000000n,32)}${(overrides.bodySender ?? word(BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES)).slice(2)}` +
    `${n(overrides.maxFee ?? 500000n,32)}${n(0n,32)}${n(0n,32)}${(overrides.hook ?? "0x").slice(2)}`) as Hex;
}
function fixture() {
  const tx = { chainId: 8453, hash, from: sender, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES };
  const receipt = { chainId: 8453, transactionHash: hash, status: "0x1", blockHash, blockNumberAtomic: "123", logs: [
    { address: BASE_CCTP_V2_MESSAGE_TRANSMITTER, topics: encodeEventTopics({ abi: sentAbi, eventName: "MessageSent" }),
      data: encodeAbiParameters([{ type: "bytes" }], [message()]) },
    { address: BASE_CCTP_V2_TOKEN_MESSENGER, topics: encodeEventTopics({ abi: burnAbi, eventName: "DepositForBurn", args: { burnToken: usdc, depositor: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, minFinalityThreshold: 1000 } }),
      data: encodeAbiParameters(burnAbi[0].inputs.filter(i => !("indexed" in i)), [100000000n, ata, 5, solanaMessenger, BRIDGE_ZERO_WORD, 500000n, "0x"]) },
  ] };
  return { tx, receipt };
}
function rejects(change: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture(); change(f);
  assert.throws(() => decodeCircleV2BaseSourceReceiptOffline(intent, f.tx, f.receipt), /circle_v2_source_/u);
}
test("authentic V2 event layout binds one source burn and message without claiming completion", () => {
  const f = fixture(); const result = decodeCircleV2BaseSourceReceiptOffline(intent, f.tx, f.receipt);
  assert.equal(result.messageHash, keccak256(message()));
  assert.equal(result.burnAmountAtomic, "100000000");
  assert.equal(result.depositor, BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES);
  assert.equal(result.mintRecipient, ata);
  assert.equal(result.executionAdmitted, false);
  assert.equal(result.bridgeCompletion, false);
  assert.equal("nonce" in result, false);
});
test("standard FORWARD quote has zero CCTP maxFee and finalized threshold, separate from wrapper fee", () => {
  const terms = circleV2BurnTermsFromQuote({ items: [{ type: "FORWARD", amount: "134620" }], feeTotalAmount: "134620" });
  assert.deepEqual(terms, { maxFeeAtomic: "0", minFinalityThreshold: 2000 });
  const f = fixture();
  const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000" as Hex;
  f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ maxFee: 0n, finality: 2000n, hook })]);
  f.receipt.logs[1]!.topics = encodeEventTopics({ abi: burnAbi, eventName: "DepositForBurn", args: {
    burnToken: usdc, depositor: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, minFinalityThreshold: 2000 } });
  f.receipt.logs[1]!.data = encodeAbiParameters(burnAbi[0].inputs.filter(i => !("indexed" in i)),
    [100000000n, ata, 5, solanaMessenger, BRIDGE_ZERO_WORD, 0n, hook]);
  const standard = { ...intent, ...terms, hookData: hook };
  assert.equal(decodeCircleV2BaseSourceReceiptOffline(standard, f.tx, f.receipt).maxFeeAtomic, "0");
  assert.throws(() => decodeCircleV2BaseSourceReceiptOffline(intent, f.tx, f.receipt), /circle_v2_source_/u);
});
test("live standard quote rejects unsupported fee items and malformed fee totals", () => {
  for (const q of [
    { items: [{ type: "PROTOCOL", amount: "2" }], feeTotalAmount: "2" },
    { items: [{ type: "FORWARD", amount: "10" }, { type: "PROTOCOL", amount: "2" }], feeTotalAmount: "12" },
    { items: [{ type: "FORWARD", amount: "10" }, { type: "PRE_FINALITY", amount: "2" }], feeTotalAmount: "12" },
    { items: [{ type: "FORWARD", amount: "10" }], feeTotalAmount: "11" },
  ]) assert.throws(() => circleV2BurnTermsFromQuote(q));
});
test("rejects missing, duplicate, wrong-emitter, reversed and failed events", () => {
  rejects(f => { f.receipt.logs.pop(); });
  rejects(f => { f.receipt.logs.push({ ...f.receipt.logs[0]! }); });
  rejects(f => { f.receipt.logs[1]!.address = BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES; });
  rejects(f => { f.receipt.logs.reverse(); });
  rejects(f => { f.receipt.status = "0x0"; });
  rejects(f => { f.tx.from = getAddress("0x000000000000000000000000000000000000bEEF"); });
  rejects(f => { f.tx.to = BASE_CCTP_V2_TOKEN_MESSENGER; });
});
test("rejects mismatched intent, burn fields, message body and nonzero nonce", () => {
  rejects(f => { f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ amount: 99999999n })]); });
  rejects(f => { f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ ata: BRIDGE_ZERO_WORD })]); });
  rejects(f => { f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ nonce: `0x${"01".repeat(32)}` })]); });
  rejects(f => { f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ headerSender: word(sender) })]); });
  rejects(f => { f.receipt.logs[0]!.data = encodeAbiParameters([{ type: "bytes" }], [message({ bodySender: word(sender) })]); });
  rejects(f => { f.receipt.logs[0]!.data = "0x1234"; });
  rejects(f => { f.receipt.logs[1]!.data = encodeAbiParameters(burnAbi[0].inputs.filter(i => !("indexed" in i)), [99999999n, ata, 5, solanaMessenger, BRIDGE_ZERO_WORD, 500000n, "0x"]); });
  assert.throws(() => decodeCircleV2BaseSourceReceiptOffline({ ...intent, solanaAtaBytes32: BRIDGE_ZERO_WORD }, fixture().tx, fixture().receipt), /circle_v2_source_/u);
});
