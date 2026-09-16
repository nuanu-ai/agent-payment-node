import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { keccak256 } from "viem";
import { inspectMayanProviderStatusOffline } from "../../src/lifi/mayan-provider-status-offline.js";

const quote = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/base-solana-mayan-mctp-quote-synthetic-20260916.json"), "utf8")) as Record<string, any>;
const binding = { sender: "0x000000000000000000000000000000000000dEaD" as const,
  solanaRecipient: "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj", sourceAmountAtomic: "100000000", maxFeeAtomic: "250000" };
const sourceTransactionHash = `0x${"a".repeat(64)}`;
const receiving = getBase58Decoder().decode(new Uint8Array(64).fill(7));
const message = `0x${"0".repeat(8)}${"0".repeat(7)}6${"0".repeat(7)}5${"0".repeat(15)}9${"0".repeat(456)}`;
function fixture() {
  return { quote, binding, sourceTransactionHash, cctpMessageHash: keccak256(message as `0x${string}`), cctpNonce: "9",
    circleMessages: { messages: [{ message, eventNonce: "9", attestation: `0x${"a".repeat(130)}` }] },
    lifiStatuses: [{ transactionId: quote.transactionId, sending: { txHash: sourceTransactionHash },
      receiving: { txHash: receiving }, tool: "mayanMCTP", status: "DONE", substatus: "COMPLETED" }] };
}
function reject(mutate: (value: ReturnType<typeof fixture>) => void): void {
  const input = fixture(); mutate(input);
  assert.throws(() => inspectMayanProviderStatusOffline(input), { code: "APN_PROVIDER_PROTOCOL" });
}

test("binds Circle V1 message and LI.FI terminal status as an offline provider hint", () => {
  const result = inspectMayanProviderStatusOffline(fixture());
  assert.equal(result.sourceTransactionHash, sourceTransactionHash);
  assert.equal(result.cctpNonce, "9");
  assert.equal(result.receivingSolanaSignature, receiving);
  assert.equal(result.providerOutcome, "completed");
  assert.equal(result.bridgeCompletion, false);
});

test("rejects Circle message, nonce, hash, attestation, and ambiguous rows", () => {
  reject(i => { i.circleMessages.messages = []; });
  reject(i => { i.circleMessages.messages.push(i.circleMessages.messages[0]!); });
  reject(i => { i.cctpMessageHash = `0x${"b".repeat(64)}`; });
  reject(i => { i.cctpNonce = "10"; });
  reject(i => { i.circleMessages.messages[0]!.eventNonce = "10"; });
  reject(i => { i.circleMessages.messages[0]!.attestation = "0x"; });
});

test("rejects LI.FI partial, refunded, pending, conflicting, or ambiguous status", () => {
  reject(i => { i.lifiStatuses[0]!.substatus = "PARTIAL"; });
  reject(i => { i.lifiStatuses[0]!.substatus = "REFUNDED"; });
  reject(i => { i.lifiStatuses[0]!.status = "PENDING"; });
  reject(i => { i.lifiStatuses[0]!.transactionId = `0x${"b".repeat(64)}`; });
  reject(i => { i.lifiStatuses[0]!.sending.txHash = `0x${"b".repeat(64)}`; });
  reject(i => { i.lifiStatuses[0]!.receiving.txHash = "not-a-solana-signature"; });
  reject(i => { i.lifiStatuses.push(i.lifiStatuses[0]!); });
  reject(i => { i.lifiStatuses[0]!.tool = "other"; });
});
