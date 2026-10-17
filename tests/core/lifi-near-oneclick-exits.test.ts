/**
 * Phase 4c (R4 exit 2) for NEAR 1Click sources, through the real CLI (`runCli` with the 1Click runtime on a synthetic Base
 * endpoint): an ambiguous source with no receipt ends `failed_proven_superseded` only once the payer's finalized nonce is
 * past its nonce while the node knows neither the transaction nor a receipt; a deposit that lands late is still observed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, getAddress, keccak256, pad, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { OneClickSourceJournal, type OneClickSourceRecord } from "../../src/lifi/near-oneclick-source-journal.js";
import { OneClickSourceService } from "../../src/lifi/near-oneclick-source-service.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), TOKEN = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const DEPOSIT = getAddress("0x76b4c56085ED136a8744D52bE956396624a730E8"), BLOCK = `0x${"e".repeat(64)}` as Hex;
const TRANSFER = keccak256(Buffer.from("Transfer(address,address,uint256)"));
const NO_SECRET = { load: async () => null, create: async () => { throw new Error("no wrapping secret in this test"); } };

/** An unknown_finality Base USDC source (nonce 7) whose deposit deadline passed a minute ago: inside the index margin. */
async function setup(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const data = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [DEPOSIT, 3000000n] });
  const journal = new OneClickSourceJournal(temp.root), deadline = new Date(Date.now() - 60_000).toISOString();
  let record: OneClickSourceRecord = await journal.stage({ lane: "base-usdc-to-tron-usdt", operationId: "a".repeat(64), profileHash: state.profileHash("oneclick-exits"),
    payer: ACCOUNT.address, recipient: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", refundTo: ACCOUNT.address, depositAddress: DEPOSIT, quoteHash: "c".repeat(64),
    quoteRequestDeadline: deadline, quoteDeadline: deadline, effectiveDeadline: deadline, amountInAtomic: "3000000", minAmountOutAtomic: "1251525",
    quotedAmountOutAtomic: "1264167", sourceBlockHash: `0x${"d".repeat(64)}`, sourceCall: { to: TOKEN, data, value: "0", nonce: "7", gas: "100000",
      maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000", maxNativeDebitWei: "200000000000000" } });
  record = await journal.advance(record.operationId, record.integrityHash, "signing_started");
  const raw = await ACCOUNT.signTransaction({ type: "eip1559", chainId: 8453, to: TOKEN, data, value: 0n, nonce: 7, gas: 100000n,
    maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  record = await journal.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
  record = await journal.advance(record.operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
  record = await journal.advance(record.operationId, record.integrityHash, "unknown_finality");
  const hash = record.transactionHash!, chain = { finalizedNonce: "0x7", landed: false, known: false }, seen: string[] = [];
  const receipt = () => ({ transactionHash: hash, to: TOKEN, from: ACCOUNT.address, blockNumber: "0x10", blockHash: BLOCK, transactionIndex: "0x0", status: "0x1",
    logs: [{ address: TOKEN, topics: [TRANSFER, pad(ACCOUNT.address).toLowerCase(), pad(DEPOSIT).toLowerCase()], data: toHex(3000000n, { size: 32 }), transactionHash: hash, blockHash: BLOCK }] });
  const answer = (method: string, params: readonly unknown[]): unknown => {
    seen.push(method);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getTransactionCount") { assert.equal(params[1], "finalized"); return chain.finalizedNonce; }
    if (method === "eth_getTransactionReceipt") return chain.landed ? receipt() : null;
    if (method === "eth_getTransactionByHash") return chain.landed || chain.known ? { hash } : null;
    if (method === "eth_getBlockByNumber") return { number: "0x20", hash: params[0] === "0x10" ? BLOCK : `0x${"f".repeat(64)}`, transactions: [hash] };
    throw new Error(`unexpected ${method}`);
  };
  t.mock.method(BridgeHttps.prototype, "request", async (url: string, _verb: string, body: string | null) => {
    if (url.startsWith("https://1click.chaindefuser.com/")) { seen.push("1click_status"); return { status: 404, body: "{}" }; }
    const request = JSON.parse(body!) as { id: number | string; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const rows = Array.isArray(request) ? request : [request], results = rows.map(row => ({ jsonrpc: "2.0", id: row.id, result: answer(row.method, row.params) }));
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? results : results[0]) };
  });
  const oneClickSource = new OneClickSourceService(state, NO_SECRET as never, { APN_BASE_RPC_URL: "https://base.example/rpc" });
  const cli = (...argv: string[]) => runCli(argv, {}, { stateRoot: temp.root, oneClickSource } as never);
  const indexState = async () => { const index = new OperationIndex(state); await index.settle(record.operationId); return (await index.find(record.operationId))?.state; };
  return { id: record.operationId, chain, seen, cli, indexState };
}
type View = { sourceState: string; sourceNeverLands: unknown; oneClickProviderStatus: unknown };
const view = (r: Awaited<ReturnType<typeof runCli>>): View => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data as View; };

test("an ambiguous source without a receipt stays open while the finalized nonce is not past, and ends failed_proven_superseded once it is", async t => {
  const f = await setup(t);
  const open = view(await f.cli("oneclick", "source", "status", "--operation", f.id));
  assert.deepEqual([open.sourceState, open.sourceNeverLands], ["unknown_finality", null]);
  assert.equal(await f.indexState(), "active");
  f.chain.finalizedNonce = "0x8"; f.seen.length = 0;
  const ended = view(await f.cli("oneclick", "source", "status", "--operation", f.id));
  assert.equal(ended.sourceState, "failed_proven_superseded");
  assert.deepEqual(ended.sourceNeverLands, { proof: "finalized_nonce_past_without_transaction_or_receipt", sourceNonce: "7", finalizedNonceAtomic: "8" });
  // The proof is one batch after the receipt read, and a never-landing deposit asks 1Click nothing.
  assert.deepEqual(f.seen, ["eth_chainId", "eth_getTransactionReceipt", "eth_chainId", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
  assert.equal(await f.indexState(), "terminal");
  // Replays answer from the journal, generic status included, with no network read.
  f.seen.length = 0;
  const generic = await f.cli("operation", "status", "--operation", f.id);
  assert.equal(generic.ok, true, JSON.stringify(generic.error));
  assert.match(JSON.stringify(generic.data ?? generic.operation), /"sourceState":"failed_proven_superseded"/u);
  assert.deepEqual(f.seen, []);
});

test("a transaction the node still knows keeps it open even with the finalized nonce past", async t => {
  const f = await setup(t); f.chain.finalizedNonce = "0x8"; f.chain.known = true;
  assert.equal(view(await f.cli("oneclick", "source", "status", "--operation", f.id)).sourceState, "unknown_finality");
  assert.equal(await f.indexState(), "active");
});

test("a deposit that lands after the deadline is observed as source_observed; 1Click's status is reported as provider data", async t => {
  const f = await setup(t); f.chain.landed = true; f.chain.finalizedNonce = "0x8";
  const observed = view(await f.cli("oneclick", "source", "status", "--operation", f.id));
  assert.deepEqual([observed.sourceState, observed.sourceNeverLands], ["source_observed", null]);
  assert.ok(f.seen.includes("1click_status"));
  assert.equal(await f.indexState(), "terminal");
});
