import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RelayGuardedOrderReferenceObserver } from "../../src/relay/order-reference-guarded.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "../../src/relay/quote.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const word = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const amount = (value: bigint) => value.toString(16).padStart(64, "0");
const depositTopic = "0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const sourceHash = hash("a"), sourceBlockHash = hash("b"), destinationHash = hash("c"), destinationBlockHash = hash("d");
const sourceSafeHash = hash("e"), destinationSafeHash = hash("f");
const intent = { payer, amountAtomic: "500000", minimumOutputAtomic: "94065", nowSeconds: 1790347296 };
type Mutation = (rows: unknown[], chain: "source" | "destination", pass: number) => void;

async function setup(mutate?: Mutation, guardLimit = 6) {
  const temp = await temporaryState(), state = new StateStore(temp.root);
  await state.initialize();
  const rawQuote = JSON.parse(await readFile("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json", "utf8"));
  const orderId = rawQuote.protocol.v2.orderId as string, deadline = rawQuote.protocol.v2.orderData.output.deadline as number;
  const sourceLog = { address: ETHEREUM_DEPOSITORY, topics: [depositTopic],
    data: `0x${word(payer)}${word(RELAY_ARBITRUM_USDC)}${amount(500000n)}${orderId.slice(2)}`,
    transactionHash: sourceHash, blockNumber: "0x64", blockHash: sourceBlockHash,
    removed: false, logIndex: "0x4" };
  const destinationLog = { address: ETHEREUM_USDC,
    topics: [transferTopic, `0x${word(payer)}`, `0x${word(rawQuote.details.recipient as string)}`],
    data: `0x${amount(94065n)}`, transactionHash: destinationHash,
    blockNumber: "0xc8", blockHash: destinationBlockHash, removed: false, logIndex: "0x7" };
  const sourceTx = { hash: sourceHash, chainId: "0xa4b1", from: payer, to: ETHEREUM_DEPOSITORY,
    input: rawQuote.steps[1].items[0].data.data, value: "0x0", blockNumber: "0x64", blockHash: sourceBlockHash };
  const destinationTx = { hash: destinationHash, chainId: "0x1", from: payer,
    to: "0x1111111111111111111111111111111111111111", input: `0xabcdef${orderId.slice(2)}`,
    value: "0x0", blockNumber: "0xc8", blockHash: destinationBlockHash };
  const sourceReceipt = { transactionHash: sourceHash, status: "0x1", blockNumber: "0x64",
    blockHash: sourceBlockHash, logs: [sourceLog] };
  const destinationReceipt = { transactionHash: destinationHash, status: "0x1", blockNumber: "0xc8",
    blockHash: destinationBlockHash, logs: [destinationLog] };
  const starts: number[] = [], methods: string[][] = [];
  let clock = 1_000_000, sourcePosts = 0, destinationPosts = 0;
  const transport = (chain: "source" | "destination") => ({ batchCall: async (calls: readonly {
    method: string; params: readonly unknown[] }[]) => {
    starts.push(clock); methods.push(calls.map(call => call.method));
    const pass = chain === "source" ? sourcePosts++ : destinationPosts++;
    const source = chain === "source";
    const rows: unknown[] = pass === 0
      ? [source ? "0xa4b1" : "0x1", source ? sourceTx : destinationTx,
        source ? sourceReceipt : destinationReceipt,
        { number: source ? "0x69" : "0xcd", hash: source ? sourceSafeHash : destinationSafeHash }]
      : [source ? "0xa4b1" : "0x1",
        { number: source ? "0x64" : "0xc8", hash: source ? sourceBlockHash : destinationBlockHash,
          timestamp: `0x${deadline.toString(16)}` },
        { number: source ? "0x69" : "0xcd", hash: source ? sourceSafeHash : destinationSafeHash },
        source ? sourceTx : destinationTx, source ? sourceReceipt : destinationReceipt,
        { number: source ? "0x69" : "0xcd", hash: source ? sourceSafeHash : destinationSafeHash }];
    mutate?.(rows, chain, pass);
    return rows;
  } });
  const sourceUrl = "https://arb-rpc.publicnode.com", destinationUrl = "https://ethereum-rpc.publicnode.com";
  const observer = new RelayGuardedOrderReferenceObserver(sourceUrl, destinationUrl, state,
    transport("source"), transport("destination"),
    () => new EvmDirectRpcGuard(state, guardLimit, () => clock, async ms => { clock += ms; }), async () => {});
  return { observer, rawQuote, cleanup: temp.cleanup, starts, methods,
    posts: () => ({ source: sourcePosts, destination: destinationPosts }), deadline };
}

test("guarded transport alone yields bounded safe order-reference proof", async t => {
  const f = await setup(); t.after(f.cleanup);
  const result = await f.observer.observe(f.rawQuote, intent, sourceHash, destinationHash);
  assert.equal(result.status, "proven");
  assert.equal(result.orderReferencedRecipientCreditProven, true);
  assert.equal(result.relayOrderFulfillmentProven, false);
  assert.equal(result.cryptographicCausalityProven, false);
  assert.equal(result.paidAcceptance, false);
  if (result.status === "proven") assert.equal(result.proof.orderId, f.rawQuote.protocol.v2.orderId);
  assert.deepEqual(f.posts(), { source: 3, destination: 3 });
  assert.equal(f.observer.physicalPosts, 6);
  assert.deepEqual(f.starts, [1_000_000, 1_000_750, 1_001_500, 1_002_250, 1_003_000, 1_003_750]);
  assert.deepEqual(f.methods.map(batch => batch.length), [4, 4, 6, 6, 6, 6]);
  await assert.rejects(f.observer.observe(f.rawQuote, intent, sourceHash, destinationHash),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(f.observer.physicalPosts, 6);
});

test("source and destination reorg, receipt drift, expiry and order suffix refuse proof", async t => {
  const cases: Mutation[] = [
    (rows, chain, pass) => { if (chain === "source" && pass === 1) rows[1] = { number: "0x64", hash: hash("1"), timestamp: "0x1" }; },
    (rows, chain, pass) => { if (chain === "source" && pass === 2) rows[4] = { ...rows[4] as object, status: "0x0" }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 2) rows[1] = { number: "0xc8", hash: hash("1"), timestamp: "0x1" }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 2) rows[1] = { ...rows[1] as object, timestamp: "0x1" }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 1) rows[1] = { ...rows[1] as object,
      timestamp: `0x${(1790952097).toString(16)}` }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 0) rows[1] = { ...rows[1] as object,
      input: `0xabcdef${hash("1").slice(2)}` }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 0) rows[2] = { ...rows[2] as object,
      logs: [{ ...((rows[2] as any).logs[0]), data: `0x${amount(94064n)}` }] }; },
    (rows, chain, pass) => { if (chain === "destination" && pass === 1) rows[5] = { number: "0xc7", hash: hash("1") }; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const f = await setup(mutate); t.after(f.cleanup);
    const result = await f.observer.observe(f.rawQuote, intent, sourceHash, destinationHash);
    assert.equal(result.orderReferencedRecipientCreditProven, false, String(index));
    assert.ok(f.observer.physicalPosts <= 6);
  }
});

test("signed quote rejection avoids POST, and hard POST cap fails closed", async t => {
  const invalid = await setup(); t.after(invalid.cleanup);
  const raw = structuredClone(invalid.rawQuote);
  raw.protocol.v2.orderData.inputs[0].payment.amount = "1";
  assert.equal((await invalid.observer.observe(raw, intent, sourceHash, destinationHash)).status, "unproven");
  assert.equal(invalid.observer.physicalPosts, 0);
  const limited = await setup(undefined, 2); t.after(limited.cleanup);
  await assert.rejects(limited.observer.observe(limited.rawQuote, intent, sourceHash, destinationHash),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.deepEqual(limited.posts(), { source: 2, destination: 2 });
});
