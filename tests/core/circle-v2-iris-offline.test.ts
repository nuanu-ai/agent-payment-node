import assert from "node:assert/strict";
import test from "node:test";
import { inspectCircleV2IrisOffline, type CircleV2ExpectedBurn } from "../../src/lifi/circle-v2-iris-offline.js";

const sourceTransactionHash = `0x${"ab".repeat(32)}`;
const sender = `0x${"00".repeat(12)}${"11".repeat(20)}`;
const recipient = `0x${"22".repeat(32)}`;
const ata = `0x${"33".repeat(32)}`;
const token = `0x${"00".repeat(12)}833589fcd6edb6e08f4c7c32d4f71b54bda02913`;
const zero = `0x${"00".repeat(32)}`;
const nonce = `0x${"44".repeat(32)}`;
function n(value: bigint | number, bytes: number): string { return BigInt(value).toString(16).padStart(bytes * 2, "0"); }
const expected: CircleV2ExpectedBurn = { sourceTransactionHash, mintRecipient: ata, amountAtomic: "1000000",
  messageSender: sender, messageRecipient: recipient, maxFeeAtomic: "1000", hookData: "0x",
  minFinalityThreshold: 2000, finalityThresholdExecuted: 2000 };
function fixture() {
  const body = `0x${n(1, 4)}${token.slice(2)}${ata.slice(2)}${n(1000000, 32)}${sender.slice(2)}${n(1000, 32)}${n(100, 32)}${n(99999999, 32)}`;
  const message = `0x${n(1, 4)}${n(6, 4)}${n(5, 4)}${nonce.slice(2)}${sender.slice(2)}${recipient.slice(2)}${zero.slice(2)}${n(2000, 4)}${n(2000, 4)}${body.slice(2)}`;
  return { sourceTxHash: sourceTransactionHash, messages: [{ message, eventNonce: "42",
    attestation: `0x${"55".repeat(65)}`, cctpVersion: 2, status: "complete",
    forwardState: "CONFIRMED", forwardTxHash: sourceTransactionHash,
    decodedMessage: { sourceDomain: "6", destinationDomain: "5", nonce: BigInt(nonce).toString(),
      sender: `0x${"11".repeat(20)}`, recipient, destinationCaller: zero, messageBody: body,
      decodedMessageBody: { burnToken: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`,
        mintRecipient: ata, amount: "1000000", messageSender: `0x${"11".repeat(20)}` } } }] };
}
function mutate(fn: (raw: ReturnType<typeof fixture>) => void): void {
  const raw = fixture(); fn(raw); assert.throws(() => inspectCircleV2IrisOffline(raw, expected), { code: "APN_PROVIDER_PROTOCOL" });
}
function patch(message: string, offset: number, bytes: string): string {
  return `${message.slice(0, 2 + offset * 2)}${bytes}${message.slice(2 + (offset + bytes.length / 2) * 2)}`;
}
test("decodes one schema-shaped V2 burn as an unauthenticated hint", () => {
  const hint = inspectCircleV2IrisOffline(fixture(), expected);
  assert.equal(hint.nonce, nonce);
  assert.equal(hint.eventNonce, "42");
  assert.equal(hint.feeExecutedAtomic, "100");
  assert.equal(hint.expirationBlock, "99999999");
  assert.equal(hint.attestationAuthenticated, false);
  assert.equal(hint.bridgeCompletion, false);
});
test("rejects ambiguous or mismatched Iris envelope", () => {
  mutate(raw => { raw.messages.push(structuredClone(raw.messages[0]!)); });
  mutate(raw => { raw.sourceTxHash = `0x${"ff".repeat(32)}`; });
  mutate(raw => { raw.messages[0]!.cctpVersion = 1; });
  mutate(raw => { raw.messages[0]!.attestation = "0x1234"; });
  mutate(raw => { raw.messages[0]!.eventNonce = "042"; });
  mutate(raw => { raw.messages[0]!.decodedMessage.nonce = "1"; });
  mutate(raw => { raw.messages[0]!.decodedMessage.decodedMessageBody.amount = "2"; });
});
test("rejects raw field mutations and extra hooks", () => {
  for (const [offset, bytes] of [[0, n(0, 4)], [4, n(7, 4)], [8, n(3, 4)],
    [108, "ff".repeat(32)], [140, n(1000, 4)], [148, n(0, 4)],
    [152, "ff".repeat(32)], [184, "ff".repeat(32)], [216, n(5, 32)],
    [280, n(1001, 32)], [312, n(0, 32)]] as const) {
    mutate(raw => { raw.messages[0]!.message = patch(raw.messages[0]!.message, offset, bytes); });
  }
  mutate(raw => { raw.messages[0]!.message += "ff"; });
  mutate(raw => { raw.messages[0]!.message = raw.messages[0]!.message.slice(0, -2); });
});
