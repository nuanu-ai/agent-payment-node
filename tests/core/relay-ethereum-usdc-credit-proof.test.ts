import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ETHEREUM_USDC } from "../../src/relay/quote.js";
import { RELAY_ETHEREUM_USDC_RECIPIENT, validateRelayArbitrumUsdcEthereumUsdcQuote } from
  "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { proveRelayEthereumUsdcCredit, type RelayEthereumUsdcProofPorts } from
  "../../src/relay/ethereum-usdc-credit-proof.js";

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
