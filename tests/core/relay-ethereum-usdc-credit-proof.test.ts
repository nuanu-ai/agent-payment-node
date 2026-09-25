import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { ApnError } from "../../src/errors.js";
import type { ReadOnlyRpcBatchCall } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDC } from "../../src/relay/quote.js";
import { RELAY_ETHEREUM_USDC_RECIPIENT, validateRelayArbitrumUsdcEthereumUsdcQuote } from
  "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { proveRelayEthereumUsdcCredit, RelayEthereumUsdcReadOnlyRpc, type RelayEthereumUsdcProofPorts } from
  "../../src/relay/ethereum-usdc-credit-proof.js";
import { temporaryState } from "./helpers.js";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const destinationHash = hash("a"), inclusionHash = hash("b"), safeHash = hash("c");
const topic = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase();
const stranger = "0x1111111111111111111111111111111111111111";

async function fixture() {
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json", "utf8"));
  const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(raw,
    { payer, amountAtomic: "500000", minimumOutputAtomic: "94065", nowSeconds: 1790347296 });
  const log = { address: ETHEREUM_USDC, topics: [transferTopic, topic(stranger), topic(recipient)],
    data: `0x${BigInt(quote.minimumOutputAtomic).toString(16).padStart(64, "0")}`,
    transactionHash: destinationHash, blockNumber: 200n, blockHash: inclusionHash, removed: false, logIndex: 3n };
  const tx = { hash: destinationHash, chainId: 1, blockNumber: 200n, blockHash: inclusionHash };
  const receipt = { transactionHash: destinationHash, status: "success" as const,
    blockNumber: 200n, blockHash: inclusionHash, logs: [log] };
  const ports: RelayEthereumUsdcProofPorts = { chainId: async () => 1,
    transaction: async () => tx, receipt: async () => receipt,
    block: async number => ({ number, hash: number === 200n ? inclusionHash : safeHash }),
    safeBlock: async () => ({ number: 205n, hash: safeHash }) };
  return { quote, ports, tx, receipt, log };
}

test("canonical safe Ethereum USDC Transfer log proves only recipient credit", async () => {
  const f = await fixture();
  const result = await proveRelayEthereumUsdcCredit(f.quote, destinationHash, f.ports);
  assert.equal(result.status, "recipient_credit_proven");
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.paidAcceptance, false);
  if (result.status === "recipient_credit_proven") {
    assert.equal(result.proof.token, ETHEREUM_USDC.toLowerCase());
    assert.equal(result.proof.recipient, recipient);
    assert.equal(result.proof.creditedAtomic, "94065");
    assert.equal(result.proof.orderId, f.quote.orderId);
    assert.equal(result.proof.transferLogIndex, "3");
  }
});

test("wrong chain, receipt, safe checkpoint, or changing canonical block fails closed", async () => {
  const f = await fixture();
  const cases: readonly [string, RelayEthereumUsdcProofPorts, string][] = [
    ["chain", { ...f.ports, chainId: async () => 8453 }, "mismatch"],
    ["tx hash", { ...f.ports, transaction: async () => ({ ...f.tx, hash: hash("f") }) }, "mismatch"],
    ["tx chain", { ...f.ports, transaction: async () => ({ ...f.tx, chainId: 42161 }) }, "mismatch"],
    ["receipt hash", { ...f.ports, receipt: async () => ({ ...f.receipt, transactionHash: hash("f") }) }, "mismatch"],
    ["revert", { ...f.ports, receipt: async () => ({ ...f.receipt, status: "reverted" }) }, "mismatch"],
    ["inclusion", { ...f.ports, block: async number => ({ number, hash: hash("f") }) }, "mismatch"],
    ["unsafe", { ...f.ports, safeBlock: async () => ({ number: 199n, hash: safeHash }) }, "pending"],
    ["head reorg", { ...f.ports, block: async number => ({ number, hash: number === 200n ? inclusionHash : hash("f") }) }, "mismatch"],
    ["missing receipt", { ...f.ports, receipt: async () => null }, "pending"],
  ];
  for (const [name, ports, expected] of cases)
    assert.equal((await proveRelayEthereumUsdcCredit(f.quote, destinationHash, ports)).status, expected, name);
  let calls = 0;
  const changing: RelayEthereumUsdcProofPorts = { ...f.ports, block: async number => {
    if (number === 200n && ++calls === 2) return { number, hash: hash("f") };
    return { number, hash: number === 200n ? inclusionHash : safeHash };
  } };
  assert.equal((await proveRelayEthereumUsdcCredit(f.quote, destinationHash, changing)).status, "mismatch");
});

test("token, recipient, amount, log identity, and ambiguity mutations never prove credit", async () => {
  const f = await fixture();
  const badLogs = [
    [{ ...f.log, address: stranger }],
    [{ ...f.log, topics: [transferTopic, topic(stranger), topic(stranger)] }],
    [{ ...f.log, data: `0x${"0".repeat(63)}1` }],
    [{ ...f.log, transactionHash: hash("f") }],
    [{ ...f.log, blockHash: hash("f") }],
    [{ ...f.log, removed: true }],
    [{ ...f.log, topics: [transferTopic, topic(stranger)] }],
    [f.log, { ...f.log, logIndex: 4n }],
    [f.log, { ...f.log }],
  ];
  for (const logs of badLogs) {
    const result = await proveRelayEthereumUsdcCredit(f.quote, destinationHash,
      { ...f.ports, receipt: async () => ({ ...f.receipt, logs }) });
    assert.notEqual(result.status, "recipient_credit_proven", JSON.stringify(logs, (_, v) => typeof v === "bigint" ? v.toString() : v));
  }
  const changedQuote = { ...f.quote, minimumOutputAtomic: "1" };
  assert.equal((await proveRelayEthereumUsdcCredit(changedQuote, destinationHash, f.ports)).status, "mismatch");
  assert.equal((await proveRelayEthereumUsdcCredit(f.quote, "0x123", f.ports)).status, "mismatch");
});

test("an unrelated USDC transfer selected by Relay is still only recipient credit", async () => {
  const f = await fixture();
  const unrelated = hash("9");
  const result = await proveRelayEthereumUsdcCredit(f.quote, unrelated, { ...f.ports,
    transaction: async () => ({ ...f.tx, hash: unrelated }),
    receipt: async () => ({ ...f.receipt, transactionHash: unrelated,
      logs: [{ ...f.log, transactionHash: unrelated }] }) });
  assert.equal(result.status, "recipient_credit_proven");
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.paidAcceptance, false);
});

test("guarded adapter uses exactly seven read POSTs with persisted family pacing", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const f = await fixture();
  let now = 1_000_000;
  const starts: number[] = [], methods: string[] = [];
  const origin = "https://ethereum-rpc.publicnode.com";
  const transport = { batchCall: async (calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> => {
    assert.equal(calls.length, 1);
    const call = calls[0]!; starts.push(now); methods.push(call.method);
    switch (call.method) {
      case "eth_chainId": return ["0x1"];
      case "eth_getTransactionByHash": return [{ hash: destinationHash, chainId: "0x1",
        blockNumber: "0xc8", blockHash: inclusionHash }];
      case "eth_getTransactionReceipt": return [{ transactionHash: destinationHash, status: "0x1",
        blockNumber: "0xc8", blockHash: inclusionHash,
        logs: [{ address: ETHEREUM_USDC, topics: f.log.topics, data: f.log.data,
          transactionHash: destinationHash, blockNumber: "0xc8", blockHash: inclusionHash,
          removed: false, logIndex: "0x3" }] }];
      case "eth_getBlockByNumber": {
        const tag = call.params[0];
        if (tag === "0xc8") return [{ number: "0xc8", hash: inclusionHash }];
        if (tag === "safe" || tag === "0xcd") return [{ number: "0xcd", hash: safeHash }];
        throw new Error("unexpected block tag");
      }
      default: throw new Error("unexpected method");
    }
  } };
  const guard = new EvmDirectRpcGuard(state, 7, () => now, async ms => { now += ms; });
  const rpc = new RelayEthereumUsdcReadOnlyRpc(origin, state,
    transport as unknown as ConstructorParameters<typeof RelayEthereumUsdcReadOnlyRpc>[2], guard);
  const result = await proveRelayEthereumUsdcCredit(f.quote, destinationHash, rpc);
  assert.equal(result.status, "recipient_credit_proven");
  assert.equal(rpc.physicalPosts, 7);
  assert.deepEqual(methods, ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt",
    "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getBlockByNumber"]);
  assert.deepEqual(starts, Array.from({ length: 7 }, (_, index) => 1_000_000 + index * 750));
  assert.equal((await readdir(join(temporary.root, "rpc-provider-pacing"))).length, 1);
  await assert.rejects(guard.post(origin, async () => { throw new Error("transport reached"); }),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  const next = new EvmDirectRpcGuard(state, 7, () => now, async ms => { now += ms; });
  await next.post("https://base-rpc.publicnode.com", async () => { starts.push(now); });
  assert.equal(starts[7], 1_000_000 + 7 * 750, "pacing survives a new guard and sibling provider endpoint");
});

test("guarded adapter makes one attempt on 429 and persists cooldown", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const origin = "https://ethereum-rpc.publicnode.com";
  let now = 2_000_000, attempts = 0;
  const transport = { batchCall: async () => {
    attempts++;
    throw new ApnError("APN_RPC_PROTOCOL", "Synthetic HTTP 429", { httpStatus: 429 });
  } };
  const guard = new EvmDirectRpcGuard(state, 7, () => now, async ms => { now += ms; });
  const rpc = new RelayEthereumUsdcReadOnlyRpc(origin, state,
    transport as unknown as ConstructorParameters<typeof RelayEthereumUsdcReadOnlyRpc>[2], guard);
  await assert.rejects(rpc.chainId(), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(attempts, 1);
  assert.equal(rpc.physicalPosts, 1);
  const nextGuard = new EvmDirectRpcGuard(state, 7, () => now, async ms => { now += ms; });
  const next = new RelayEthereumUsdcReadOnlyRpc(origin, state,
    transport as unknown as ConstructorParameters<typeof RelayEthereumUsdcReadOnlyRpc>[2], nextGuard);
  await assert.rejects(next.chainId(), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(attempts, 1);
});
