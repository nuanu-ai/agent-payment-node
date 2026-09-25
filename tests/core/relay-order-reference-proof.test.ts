import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Hex } from "viem";
import { RELAY_ARBITRUM_USDC, validateRelayArbitrumUsdcEthereumUsdcQuote } from
  "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { proveRelayOrderReferencedRecipientCredit, type RelayOrderReferenceEvidence } from
  "../../src/relay/order-reference-proof.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "../../src/relay/quote.js";

const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const word = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const quantity = (value: bigint) => value.toString(16).padStart(64, "0");
const depositTopic = "0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";

async function fixture(): Promise<RelayOrderReferenceEvidence> {
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json", "utf8"));
  const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(raw,
    { payer, amountAtomic: "500000", minimumOutputAtomic: "94065", nowSeconds: 1790347296 });
  const sourceHash = hash("a"), sourceBlockHash = hash("b"), destinationHash = hash("c"), destinationBlockHash = hash("d");
  const sourceReceipt = { transactionHash: sourceHash, status: "success" as const, blockNumber: 100n,
    blockHash: sourceBlockHash, logs: [{ address: ETHEREUM_DEPOSITORY, topics: [depositTopic],
      data: `0x${word(payer)}${word(RELAY_ARBITRUM_USDC)}${quantity(500000n)}${quote.orderId.slice(2)}`,
      transactionHash: sourceHash, blockNumber: 100n, blockHash: sourceBlockHash, removed: false, logIndex: 4n }] };
  const destinationReceipt = { transactionHash: destinationHash, status: "success" as const,
    blockNumber: 200n, blockHash: destinationBlockHash, logs: [{ address: ETHEREUM_USDC,
      topics: [transferTopic, `0x${word(payer)}`, `0x${word(quote.recipient)}`],
      data: `0x${quantity(94065n)}`, transactionHash: destinationHash, blockNumber: 200n,
      blockHash: destinationBlockHash, removed: false, logIndex: 7n }] };
  return { quote, sourceProof: { sourceChainId: 42161, rpcOrigin: "https://arb-rpc.example",
    deposit: { transactionHash: sourceHash, blockNumber: "100", blockHash: sourceBlockHash },
    approval: null, safeHead: { number: "105", hash: hash("e") },
    proofClass: "canonical_safe_source_receipts", destinationDeliveryProven: false,
    causalLinkCryptographicallyProven: false, paidAcceptance: false }, sourceReceipt,
    destinationCredit: { status: "recipient_credit_proven", relayOrderFulfillmentProven: false,
      paidAcceptance: false, proof: { quoteDigest: quote.quoteDigest, orderId: quote.orderId,
        destinationTransactionHash: destinationHash, destinationBlockNumber: "200",
        destinationBlockHash, safeBlockNumber: "205", safeBlockHash: hash("f"),
        token: ETHEREUM_USDC.toLowerCase(), recipient: quote.recipient,
        minimumOutputAtomic: quote.minimumOutputAtomic, creditedAtomic: "94065",
        transferLogIndex: "7", proofClass: "canonical_safe_erc20_transfer_log" } },
    destinationReceipt,
    destinationTransaction: { hash: destinationHash, chainId: 1, blockNumber: 200n,
      blockHash: destinationBlockHash, input: `0xabcdef${quote.orderId.slice(2)}` },
    destinationBlock: { number: 200n, hash: destinationBlockHash, timestampSeconds: BigInt(quote.deadline) } };
}

test("matching safe receipts bind an onchain deposit event, destination calldata and recipient credit only", async () => {
  const f = await fixture();
  const result = await proveRelayOrderReferencedRecipientCredit(f);
  assert.equal(result.orderReferencedRecipientCreditProven, true);
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.cryptographicCausalityProven, false);
  assert.equal(result.paidAcceptance, false);
  assert.equal(result.proof?.orderId, f.quote.orderId);
  assert.equal(result.proof?.sourceDepositLogIndex, "4");
  assert.equal(result.proof?.destinationTransferLogIndex, "7");
});

test("source event identity, ABI shape, principal and uniqueness mutations fail closed", async () => {
  const f = await fixture(), log = f.sourceReceipt.logs[0]!;
  const bad = [
    { ...log, address: payer }, { ...log, topics: [depositTopic, hash("1")] },
    { ...log, data: `${log.data}00` }, { ...log, data: `0x${word(payer)}${word(RELAY_ARBITRUM_USDC)}${quantity(499999n)}${f.quote.orderId.slice(2)}` },
    { ...log, data: `0x${word(payer)}${word(RELAY_ARBITRUM_USDC)}${quantity(500000n)}${hash("1").slice(2)}` },
    { ...log, data: `0x${word(payer)}${word(ETHEREUM_USDC)}${quantity(500000n)}${f.quote.orderId.slice(2)}` },
    { ...log, transactionHash: hash("1") }, { ...log, removed: true },
  ];
  for (const changed of bad) {
    const result = await proveRelayOrderReferencedRecipientCredit({ ...f,
      sourceReceipt: { ...f.sourceReceipt, logs: [changed] } });
    assert.equal(result.orderReferencedRecipientCreditProven, false);
  }
  for (const logs of [[log, { ...log, logIndex: 5n }], [log, { ...log }]])
    assert.equal((await proveRelayOrderReferencedRecipientCredit({ ...f,
      sourceReceipt: { ...f.sourceReceipt, logs } })).orderReferencedRecipientCreditProven, false);
});

test("destination order suffix, deadline, transfer and canonical identity mutations fail closed", async () => {
  const f = await fixture(), log = f.destinationReceipt.logs[0]!;
  const cases: RelayOrderReferenceEvidence[] = [
    { ...f, destinationTransaction: { ...f.destinationTransaction, input: `0x1234${hash("1").slice(2)}` } },
    { ...f, destinationTransaction: { ...f.destinationTransaction, blockHash: hash("1") } },
    { ...f, destinationBlock: { ...f.destinationBlock, timestampSeconds: BigInt(f.quote.deadline) + 1n } },
    { ...f, destinationBlock: { ...f.destinationBlock, hash: hash("1") } },
    { ...f, destinationReceipt: { ...f.destinationReceipt, status: "reverted" } },
    { ...f, destinationReceipt: { ...f.destinationReceipt, logs: [{ ...log, data: `0x${quantity(94064n)}` }] } },
    { ...f, destinationReceipt: { ...f.destinationReceipt, logs: [{ ...log, topics: [transferTopic, `0x${word(payer)}`, `0x${word(payer)}`] }] } },
    { ...f, destinationReceipt: { ...f.destinationReceipt, logs: [log, { ...log, logIndex: 8n }] } },
    { ...f, destinationReceipt: { ...f.destinationReceipt, logs: [log, { ...log }] } },
    { ...f, sourceProof: { ...f.sourceProof, safeHead: { ...f.sourceProof.safeHead, number: "99" } } },
    { ...f, destinationCredit: { status: "pending", reason: "safe head missing",
      relayOrderFulfillmentProven: false, paidAcceptance: false } },
  ];
  for (const [index, changed] of cases.entries())
    assert.equal((await proveRelayOrderReferencedRecipientCredit(changed)).orderReferencedRecipientCreditProven, false, String(index));
});

test("tampered quote and proof bindings never promote credit", async () => {
  const f = await fixture();
  const changed = [
    { ...f, quote: { ...f.quote, principalAtomic: "1" } },
    { ...f, quote: { ...f.quote, orderId: hash("1") } },
    { ...f, destinationCredit: { ...f.destinationCredit, proof: {
      ...(f.destinationCredit.status === "recipient_credit_proven" ? f.destinationCredit.proof : {}),
      orderId: hash("1") } } },
  ];
  for (const item of changed)
    assert.equal((await proveRelayOrderReferencedRecipientCredit(item as RelayOrderReferenceEvidence)).orderReferencedRecipientCreditProven, false);
});
