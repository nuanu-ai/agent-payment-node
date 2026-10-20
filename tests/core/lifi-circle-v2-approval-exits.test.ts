/**
 * Phase 4c (R4 exit 2) for the Circle Base USDC approval, through the real CLI (`runCli` with the approval runtime on a
 * synthetic Base port): an ambiguous approval with no receipt ends `failed_proven_superseded` only once the payer's
 * finalized nonce is past its nonce while the node knows neither the transaction nor a receipt; status says what a
 * completed approval leaves on chain.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, pad, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { checkNeverLands, environmentFinalizedReader } from "../../src/evm-finalized-proof.js";
import { CircleV2ApprovalExecutor, type CircleApprovalRecord, type CircleApprovalRpc } from "../../src/lifi/circle-v2-approval-executor.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`), token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
const now = () => 1_800_000_000_000;
const ERA_HASH = `0x${"a".repeat(64)}`, PROBE = `0x${"9a".repeat(32)}`;

async function setup(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile: "test", profileHash: state.profileHash("test"), address: account.address,
    createdAt: "2026-01-01T00:00:00.000Z", bindingHash: "binding" }));
  const chain = { ambiguous: true, include: false, finalizedNonce: "7", known: false, indexed: true, unlandedReads: 0 }, sent: Hex[] = [];
  const rpc: CircleApprovalRpc = { chainId: 8453, origin: "https://base.example",
    read: async () => ({ chainId: 8453, payer: account.address, token, spender, blockNumber: "12345", blockHash: `0x${"a".repeat(64)}`, latestNonceAtomic: "7",
      pendingNonceAtomic: "7", usdcBalanceAtomic: "434611", usdcAllowanceAtomic: chain.include ? "430000" : "0", nativeBalanceWei: "200000000000000",
      gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", totalNativeDebitWei: "200000000000000" }),
    send: async raw => { sent.push(raw); if (chain.ambiguous) throw new Error("lost response"); return keccak256(raw); },
    observe: async hash => chain.include ? { status: "success", safe: true, receipt: { chainId: 8453, transactionHash: hash, blockNumberAtomic: "12345",
      blockHash: `0x${"a".repeat(64)}` as Hex, logs: [{ address: token as Hex, topics: [keccak256(Buffer.from("Approval(address,address,uint256)")),
        pad(account.address).toLowerCase() as Hex, pad(spender).toLowerCase() as Hex], data: toHex(430000n, { size: 32 }) }] } } : null,
    // The finalized-tag node: the preparation's block (12345, 0xaa..) holds PROBE, which the node indexes unless `indexed` is off.
    finalizedBatch: async calls => { chain.unlandedReads++; const hash = keccak256(sent[0]!);
      return calls.map(({ method, params }) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getTransactionCount") { assert.deepEqual(params, [account.address, "finalized"]); return toHex(BigInt(chain.finalizedNonce)); }
        if (method === "eth_getTransactionReceipt") { assert.deepEqual(params, [hash]); return null; }
        if (method === "eth_getBlockTransactionCountByNumber") { assert.deepEqual(params, ["0x3039"]); return "0x2"; }
        if (method === "eth_getTransactionByBlockNumberAndIndex") { assert.deepEqual(params, ["0x3039", "0x0"]); return { hash: PROBE, blockHash: ERA_HASH, blockNumber: "0x3039" }; }
        if (method === "eth_getTransactionByHash") return params[0] === hash ? (chain.known ? { hash } : null)
          : chain.indexed ? { hash: PROBE, blockHash: ERA_HASH, blockNumber: "0x3039" } : null;
        throw new Error(`unexpected ${method}`);
      }); } };
  const signer = { sign: async (r: CircleApprovalRecord) => { const e = r.preparation.transaction;
    return await account.signTransaction({ type: "eip1559", chainId: 8453, to: token, data: e.data as Hex, value: 0n, nonce: Number(e.nonceAtomic),
      gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasWei), accessList: [] }); } };
  const circleApproval = new CircleV2ApprovalExecutor(state, rpc, signer, limits, now);
  const record = await circleApproval.prepare({ profile: "test", payer: account.address, walletBindingHash: "binding", walletCreatedAt: "2026-01-01T00:00:00.000Z",
    approvalCapAtomic: "430000" });
  const status = async () => {
    const result = await runCli(["circle", "approval", "status", "--operation", record.id], {}, { stateRoot: temp.root, circleApproval } as never);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.data as CircleApprovalRecord & { allowance: Record<string, unknown> };
  };
  const indexState = async () => { const index = new OperationIndex(state); await index.settle(record.id); return (await index.find(record.id))?.state; };
  return { id: record.id, root: temp.root, chain, sent, execute: () => circleApproval.execute(record.id, async () => true), status, indexState };
}

test("an ambiguous approval without a receipt stays open while the finalized nonce is not past or the node knows it, then ends superseded", async t => {
  const f = await setup(t);
  assert.equal((await f.execute()).phase, "unknown_finality");
  const open = await f.status();
  assert.deepEqual([open.phase, open.finalizedNonceAtomic, open.allowance], ["unknown_finality", undefined, { effect: "unknown_until_resolved" }]);
  assert.equal(await f.indexState(), "active");
  f.chain.finalizedNonce = "8"; f.chain.known = true;
  assert.equal((await f.status()).phase, "unknown_finality");
  // A node whose transaction index does not reach the preparation's block proves nothing: it would not know a landed approval.
  f.chain.known = false; f.chain.indexed = false;
  assert.equal((await f.status()).phase, "unknown_finality");
  f.chain.indexed = true;
  const ended = await f.status();
  assert.deepEqual([ended.phase, ended.finalizedNonceAtomic, ended.allowance], ["failed_proven_superseded", "8", { effect: "allowance_unchanged" }]);
  assert.equal(await f.indexState(), "terminal");
  const reads = f.chain.unlandedReads;
  assert.equal((await f.status()).phase, "failed_proven_superseded");
  assert.deepEqual([f.chain.unlandedReads, f.sent.length], [reads, 1]);
});

test("status of a completed approval names the allowance it leaves, what spends it, and the revoke that clears it", async t => {
  const f = await setup(t); f.chain.ambiguous = false; f.chain.include = true;
  assert.equal((await f.execute()).phase, "completed");
  const done = await f.status();
  assert.deepEqual(done.allowance, { effect: "allowance_set", token, owner: account.address, spender, approvedAtomic: "430000", observedAtCompletionAtomic: "430000",
    spentBy: "apn circle source submit", revoke: "apn circle approval revoke --profile test --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> " +
      "--max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>" });
  assert.equal(f.chain.unlandedReads, 0);
});

test("the production proof reads APN_BASE_RPC_URL at the finalized tag (first batch, era block data, deciding batch), and refuses without that endpoint", async t => {
  const posts: unknown[] = [], hash = `0x${"b".repeat(64)}` as Hex;
  t.mock.method(BridgeHttps.prototype, "request", async (url: string, _verb: string, body: string) => {
    const rows = JSON.parse(body) as { id: number; method: string; params: unknown[] }[]; posts.push({ url, rows: rows.map(row => [row.method, row.params]) });
    const values: Record<string, unknown> = { eth_chainId: "0x2105", eth_getTransactionCount: "0x8", eth_getTransactionReceipt: null,
      eth_getBlockTransactionCountByNumber: "0x2", eth_getTransactionByBlockNumberAndIndex: { hash: PROBE, blockHash: ERA_HASH, blockNumber: "0x3039" } };
    const result = (row: { method: string; params: unknown[] }) => row.method !== "eth_getTransactionByHash" ? values[row.method]
      : row.params[0] === PROBE ? { hash: PROBE, blockHash: ERA_HASH, blockNumber: "0x3039" } : null;
    return { status: 200, body: JSON.stringify(rows.map(row => ({ jsonrpc: "2.0", id: row.id, result: result(row) }))) };
  });
  const check = await checkNeverLands({ chainId: 8453, account: account.address, nonce: 7n, transactionHash: hash, before: { hash: ERA_HASH, number: 12345n } },
    environmentFinalizedReader({ APN_BASE_RPC_URL: "https://base.example/rpc" })(8453).batch);
  assert.deepEqual(check, { neverLands: true, finalizedNonce: 8n });
  const own = [["eth_getTransactionCount", [account.address, "finalized"]], ["eth_getTransactionReceipt", [hash]], ["eth_getTransactionByHash", [hash]]];
  assert.deepEqual(posts, [{ url: "https://base.example/rpc", rows: [["eth_chainId", []], ...own] },
    { url: "https://base.example/rpc", rows: [["eth_getBlockTransactionCountByNumber", ["0x3039"]], ["eth_getTransactionByBlockNumberAndIndex", ["0x3039", "0x0"]]] },
    { url: "https://base.example/rpc", rows: [...own, ["eth_getTransactionByHash", [PROBE]]] }]);
  assert.throws(() => environmentFinalizedReader({})(8453), { code: "APN_RPC_CONFIG" });
});

test("owner abandon of an ambiguous approval: refused before expiry, TTY consent after it ends abandoned_unknown; a replay asks nothing", async t => {
  const f = await setup(t), calls: OperationAbandonIntent[] = [], approval: OperationAbandonApprovalPort = { approve: async intent => { calls.push(intent); } };
  assert.equal((await f.execute()).phase, "unknown_finality");
  const abandon = (at: number) => runCli(["operation", "abandon", "--operation", f.id], {}, { stateRoot: f.root, clock: { now: () => new Date(at) },
    operationAbandonApproval: approval } as never);
  assert.equal((await abandon(now())).error?.details?.reason, "circle_approval_abandon_before_expiry");
  const done = await abandon(now() + 120_000);
  assert.equal(done.ok, true, JSON.stringify(done.error));
  assert.match(JSON.stringify(done.operation ?? done.data), /"phase":"abandoned_unknown".*"effect":"unknown_may_still_land"/u);
  assert.deepEqual([calls.length, calls[0]!.recipient, calls[0]!.amountAtomic], [1, spender, "430000"]);
  assert.match(calls[0]!.outcomeNote, /UNKNOWN/u);
  assert.equal(await f.indexState(), "terminal");
  assert.equal((await abandon(now() + 180_000)).ok, true);
  assert.deepEqual([calls.length, f.sent.length], [1, 1]);
});
