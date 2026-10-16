import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { freezeRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { proveRelayBnbDestination, RELAY_ROUTER_V3, type RelayBnbProofPorts, type RelayBnbReceipt } from "../../src/relay/destination-proof.js";
import { ETHEREUM_DEPOSITORY, validateRelayQuote } from "../../src/relay/quote.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase();
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const hash = (digit: string) => `0x${digit.repeat(64)}`;

async function fixture() {
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quote = await validateRelayQuote(raw, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: payer, recipient, quoteDigest: quote.quoteDigest, quote, policyDigest: "5".repeat(64),
    policyRevision: 1, approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "2500000",
    minOutputAtomic: quote.minimumOutputWei, createdAt: "2026-09-30T00:00:00.000Z",
    deadline: new Date(quote.deadline * 1000).toISOString() });
  const sourceDeposit = { transactionHash: hash("a"), observation: {
    transaction: { hash: hash("a"), from: payer, to: ETHEREUM_DEPOSITORY,
      input: quote.deposit.data, value: 0n, chainId: 1 },
    receipt: { transactionHash: hash("a"), status: "success" as const, blockNumber: 100n, blockHash: hash("b") },
    canonicalBlockHash: hash("b") } };
  const destHash = hash("c"), destBlockHash = hash("d"), safeHash = hash("e");
  const ports: RelayBnbProofPorts = {
    chainId: async () => 56,
    transaction: async () => ({ hash: destHash, chainId: 56, to: recipient,
      valueWei: BigInt(op.minOutputAtomic), blockNumber: 200n, blockHash: destBlockHash }),
    receipt: async () => ({ transactionHash: destHash, status: "success", blockNumber: 200n, blockHash: destBlockHash, logs: [] }),
    block: async number => ({ number, hash: number === 200n ? destBlockHash : safeHash }),
    finalityCheckpoint: async () => ({ number: 205n, hash: safeHash }),
  };
  const input = { operation: op, sourceDeposit, candidateHashes: [destHash] };
  return { input, ports, destHash, destBlockHash, safeHash };
}

test("direct BNB native credit is observed only after canonical safe receipt and source deposit", async () => {
  const f = await fixture();
  const result = await proveRelayBnbDestination(f.input, f.ports);
  assert.equal(result.status, "recipient_credit_proven");
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.paidAcceptance, false);
  if (result.status === "recipient_credit_proven") {
    assert.equal(result.proof.method, "direct_native_transaction");
    assert.equal(result.proof.orderId, f.input.operation.quote!.orderId);
    assert.equal(result.proof.creditedWei, f.input.operation.minOutputAtomic);
  }
});

test("reorg, unsafe inclusion, wrong recipient or value, and failed receipt never prove", async () => {
  const f = await fixture();
  const tx = await f.ports.transaction(f.destHash); assert.ok(tx);
  const receipt = await f.ports.receipt(f.destHash); assert.ok(receipt);
  const cases: readonly [RelayBnbProofPorts, string][] = [
    [{ ...f.ports, block: async number => ({ number, hash: hash("f") }) }, "mismatch"],
    [{ ...f.ports, finalityCheckpoint: async () => ({ number: 199n, hash: f.safeHash }) }, "pending"],
    [{ ...f.ports, transaction: async () => ({ ...tx, to: "0x1111111111111111111111111111111111111111" }) }, "unproven"],
    [{ ...f.ports, transaction: async () => ({ ...tx, valueWei: 1n }) }, "mismatch"],
    [{ ...f.ports, receipt: async () => ({ ...receipt, status: "reverted" }) }, "mismatch"],
    [{ ...f.ports, chainId: async () => 1 }, "mismatch"],
  ];
  for (const [ports, expected] of cases) assert.equal((await proveRelayBnbDestination(f.input, ports)).status, expected);
  const failedSource = { ...f.input, sourceDeposit: { ...f.input.sourceDeposit,
    observation: { ...f.input.sourceDeposit.observation,
      receipt: { ...f.input.sourceDeposit.observation.receipt, status: "reverted" as const } } } };
  assert.equal((await proveRelayBnbDestination(failedSource, f.ports)).status, "mismatch");
});

test("contract payout is proven by the pinned router's SolverNativeTransfer in the receipt; ambiguous or foreign events stay unproven", async () => {
  const f = await fixture();
  const tx = await f.ports.transaction(f.destHash); assert.ok(tx);
  const receipt = await f.ports.receipt(f.destHash) as RelayBnbReceipt; assert.ok(receipt);
  const solverTopic = "0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6";
  const event = (to: string, amount: bigint, address = RELAY_ROUTER_V3) => ({ address, topics: [solverTopic],
    data: `0x${to.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` });
  const minimum = BigInt(f.input.operation.minOutputAtomic);
  const contract = (logs: NonNullable<RelayBnbReceipt["logs"]>) => ({ ...f.ports,
    transaction: async () => ({ ...tx, to: "0x1111111111111111111111111111111111111111", valueWei: 0n }),
    receipt: async () => ({ ...receipt, logs }) });
  assert.equal((await proveRelayBnbDestination(f.input, contract([]))).status, "unproven");
  const proven = await proveRelayBnbDestination(f.input, contract([event(RELAY_ROUTER_V3, minimum), event(recipient, minimum)]));
  assert.equal(proven.status, "recipient_credit_proven");
  if (proven.status === "recipient_credit_proven") { assert.equal(proven.proof.method, "relay_router_event"); assert.equal(proven.proof.creditedWei, minimum.toString()); }
  assert.equal((await proveRelayBnbDestination(f.input, contract([event(recipient, minimum), event(recipient, minimum)]))).status, "unproven");
  assert.equal((await proveRelayBnbDestination(f.input, contract([event(recipient, minimum, "0x2222222222222222222222222222222222222222")]))).status, "unproven");
  assert.equal((await proveRelayBnbDestination(f.input, contract([event(recipient, minimum - 1n)]))).status, "mismatch");
});

test("one proof requests chain, transaction, receipt and checkpoint together, then the inclusion block", async () => {
  // Each read resolves only when its simulated batch POST flushes, as with the real adapter.
  const f = await fixture(), order: string[][] = []; let pending: { name: string; run: () => void }[] = [];
  const track = <T>(name: string, value: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    pending.push({ name, run: () => { value().then(resolve, reject); } });
    if (pending.length === 1) setImmediate(() => { const batch = pending; pending = []; order.push(batch.map(x => x.name)); for (const x of batch) x.run(); });
  });
  const ports: RelayBnbProofPorts = { chainId: () => track("chain", f.ports.chainId), transaction: hash => track("tx", () => f.ports.transaction(hash)),
    receipt: hash => track("receipt", () => f.ports.receipt(hash)), block: number => track(`block:${number}`, () => f.ports.block(number)),
    finalityCheckpoint: () => track("checkpoint", f.ports.finalityCheckpoint) };
  assert.equal((await proveRelayBnbDestination(f.input, ports)).status, "recipient_credit_proven");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, [["receipt", "chain", "tx", "checkpoint"], ["block:200"]]);
});

test("an unrelated valid transfer to the recipient remains credit evidence, never Relay fulfillment", async () => {
  const f = await fixture();
  // This hash belongs to a different sender's ordinary BNB transfer. Relay merely suggested it.
  const unrelatedHash = hash("9");
  const ordinaryTransaction = await f.ports.transaction(f.destHash); assert.ok(ordinaryTransaction);
  const ordinaryReceipt = await f.ports.receipt(f.destHash); assert.ok(ordinaryReceipt);
  const result = await proveRelayBnbDestination({ ...f.input, candidateHashes: [unrelatedHash] }, {
    ...f.ports,
    transaction: async () => ({ ...ordinaryTransaction, hash: unrelatedHash }),
    receipt: async () => ({ ...ordinaryReceipt, transactionHash: unrelatedHash }),
  });
  assert.equal(result.status, "recipient_credit_proven");
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.paidAcceptance, false);
  if (result.status === "recipient_credit_proven") assert.equal(result.proof.destinationTransactionHash, unrelatedHash);
});
