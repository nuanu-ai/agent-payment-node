import assert from "node:assert/strict";
import test from "node:test";
import { parseTronDestinationCandidate } from "../../src/lifi/tron-destination-candidate.js";
import { TRON_TRANSFER_TOPIC, TRON_USDT_HEX, tronHex, tronWord } from "../../src/tron/codec.js";
import { TRON_RECIPIENT } from "./tron-helpers.js";

const transactionId = "ab".repeat(32);
const sender = "41" + "12".repeat(20);
const other = "41" + "34".repeat(20);
const value = (amount: bigint) => amount.toString(16).padStart(64, "0");
const transfer = (from: string, to: string, amount: bigint) => ({ address: TRON_USDT_HEX.slice(2),
  topics: [TRON_TRANSFER_TOPIC, tronWord(from), tronWord(to)], data: value(amount) });

function fixture() {
  return { transactionId, recipient: TRON_RECIPIENT, minimumOutputAtomic: "900000", providerOutcome: "completed" as const,
    transaction: { txID: transactionId, ret: [{ ret: "SUCESS", contractRet: "SUCCESS" }] },
    transactionInfo: { id: transactionId, result: "SUCESS", receipt: { result: "SUCCESS" },
      log: [transfer(sender, TRON_RECIPIENT, 600000n), transfer(other, TRON_RECIPIENT, 500000n)] } };
}
function refused(change: (input: ReturnType<typeof fixture>) => void) {
  const input = fixture(); change(input);
  assert.throws(() => parseTronDestinationCandidate(input), { code: "APN_RPC_PROTOCOL" });
}

test("solidified canonical USDT logs sum the recipient's net delta without claiming bridge completion", () => {
  const proof = parseTronDestinationCandidate(fixture());
  assert.equal(proof.receivedAtomic, "1100000");
  assert.equal(proof.recipient, TRON_RECIPIENT);
  assert.equal(proof.token, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  assert.equal(proof.sourceMessageCorrelation, "unverified");
  assert.equal(proof.bridgeCompletion, false);
  const net = fixture(); net.transactionInfo.log.push(transfer(TRON_RECIPIENT, other, 100000n));
  assert.equal(parseTronDestinationCandidate(net).receivedAtomic, "1000000");
  const hex = fixture(); hex.recipient = tronHex(TRON_RECIPIENT);
  assert.equal(parseTronDestinationCandidate(hex).recipient, TRON_RECIPIENT);
});

test("refuses mismatched identity, unsuccessful body or receipt, and provider exceptions", () => {
  refused((i) => { i.transaction.txID = "cd".repeat(32); });
  refused((i) => { i.transactionInfo.id = "cd".repeat(32); });
  refused((i) => { i.transaction.ret[0]!.contractRet = "REVERT"; });
  refused((i) => { i.transaction.ret[0]!.ret = "FAILED"; });
  refused((i) => { i.transactionInfo.result = "FAILED"; });
  refused((i) => { i.transactionInfo.receipt.result = "REVERT"; });
  refused((i) => { i.transaction.ret = []; });
  for (const outcome of ["pending", "partial", "refunded", "failed", "unknown", "COMPLETED"]) {
    refused((i) => { (i as { providerOutcome: unknown }).providerOutcome = outcome; });
  }
});

test("refuses wrong contract, recipient, amount, and offsetting outgoing transfers", () => {
  refused((i) => { i.transactionInfo.log[0]!.address = "ab".repeat(20); i.transactionInfo.log[1]!.address = "ab".repeat(20); });
  refused((i) => { i.transactionInfo.log[0]!.topics[2] = tronWord(other); i.transactionInfo.log[1]!.topics[2] = tronWord(other); });
  refused((i) => { i.transactionInfo.log[1]!.data = value(200000n); });
  refused((i) => { i.transactionInfo.log.push(transfer(TRON_RECIPIENT, other, 300000n)); });
  refused((i) => { i.transactionInfo.log = []; });
});

test("refuses malformed or ambiguous Transfer logs rather than skipping them", () => {
  refused((i) => { i.transactionInfo.log[0]!.topics[0] = "ff".repeat(32); i.transactionInfo.log[1]!.topics[0] = "ff".repeat(32); });
  refused((i) => { i.transactionInfo.log[0]!.topics.pop(); });
  refused((i) => { i.transactionInfo.log[0]!.topics[2] = "41" + tronWord(TRON_RECIPIENT).slice(2); });
  refused((i) => { i.transactionInfo.log[0]!.data = "0x" + value(600000n); });
  refused((i) => { i.transactionInfo.log[0]!.data = value(600000n).slice(2); });
  refused((i) => { i.transactionInfo.log[0]!.address = TRON_USDT_HEX; });
  refused((i) => { (i.transactionInfo.log as unknown[]).push(null); });
});
