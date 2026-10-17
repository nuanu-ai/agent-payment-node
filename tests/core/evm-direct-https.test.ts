import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { keccak256 } from "viem";
import { ApnCore } from "../../src/core.js";
import { directEvmStepBudget } from "../../src/evm-direct-reads.js";
import { EvmDirectSubmissionJournal } from "../../src/evm-direct-submission.js";
import type { Address } from "../../src/model.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy, directAdmission, evmDirectAdmissions, EVM_USDC } from "./direct-allowlist-helpers.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { mockEvmHttps } from "./evm-https-chain.js";
import { WALLET, temporaryState } from "./helpers.js";

const USDT0 = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" as Address;

/** The production transport and guard; it records the cap each invocation armed. */
class RecordingRpc extends HttpsBaseRpc {
  readonly caps: (number | undefined)[] = [];
  override armEvmDirectRpcGuard(cap?: number): void { this.caps.push(cap); super.armEvmDirectRpcGuard(cap); }
}

for (const scenario of [
  { name: "Ethereum USDC", chainId: 1 as const, token: EVM_USDC[1] as Address, posts: { prepare: 2, approve: 5 } },
  { name: "Base native", chainId: 8453 as const, token: "native" as const, posts: { prepare: 3, approve: 6 } },
  { name: "Arbitrum USD₮0", chainId: 42161 as const, token: USDT0, posts: { prepare: 2, approve: 5 } },
  { name: "Sei native", chainId: 1329 as const, token: "native" as const, posts: { prepare: 2, approve: 5 } },
]) test(`${scenario.name}: prepare and approve follow the read plan, prove the chain once per invocation and complete in one approve`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(), admissions: [...evmDirectAdmissions(),
    directAdmission("eip155:42161", USDT0), directAdmission("eip155:1329", null)] });
  const chain = mockEvmHttps(t, scenario.chainId, () => wallet.address);
  const invocation = () => {
    const rpc = new RecordingRpc("https://8.8.8.8/rpc", { directGuardState: setup.state });
    return { rpc, core: new ApnCore({ state: setup.state, rpc, native: setup.local, clock: setup.clock }) };
  };
  const first = invocation();
  const prepared = await first.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: scenario.chainId, token: scenario.token,
    ...(scenario.token === "native" ? {} : { decimals: 6 }) }, amount: scenario.token === "native" ? "0.000001" : "0.1",
  idempotencyKey: `https-direct-${scenario.chainId}` }) as { operation_id: string; state: string };
  assert.equal(prepared.state, "awaiting_approval");
  assert.equal(chain.posts.length, scenario.posts.prepare);
  assert.deepEqual(first.rpc.caps, [directEvmStepBudget(scenario.chainId, "prepare")]);
  assert.equal(chain.posts.flat().filter(method => method === "eth_chainId").length, 1);
  chain.posts.length = 0;
  const second = invocation();
  const approved = await second.core.transfer.approve(prepared.operation_id) as { state: string; reason: string };
  assert.deepEqual([approved.state, approved.reason], ["completed", scenario.token === "native" ? "confirmed_exact_native_transfer" : "confirmed_exact_erc20_transfer"],
    "the receipt and its evidence are read in the approving invocation");
  assert.equal(chain.posts.length, scenario.posts.approve);
  assert.ok(chain.posts.length <= directEvmStepBudget(scenario.chainId, "approve"));
  assert.deepEqual(second.rpc.caps, [directEvmStepBudget(scenario.chainId, "approve")]);
  assert.equal(chain.posts.flat().filter(method => method === "eth_chainId").length, 1);
  const safe = scenario.chainId === 42161 || scenario.chainId === 1329;
  assert.equal(chain.posts.flat().filter(method => method === "eth_getBlockByNumber").length, safe ? 4 : 3,
    "the balance head, the fee head, the receipt block and a safe head where required; nothing is re-read around them");
  assert.deepEqual(chain.posts.at(-1), ["eth_getBlockByNumber", "eth_getTransactionByHash", ...(safe ? ["eth_getBlockByNumber"] : [])]);
  assert.equal(chain.sends.length, 1);
  chain.posts.length = 0;
  assert.equal((await invocation().core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(chain.posts.length, 0); assert.equal(chain.sends.length, 1);
});

for (const receipts of [true, false]) test(`resume sends an undispatched signature once, unchanged, without a new signature, and inspects it (receipt ${receipts ? "found" : "absent"})`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let signedRaw: `0x${string}` | undefined;
  const setup = evmCore(temporary.root, undefined, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") signedRaw = (result as { rawTransaction: `0x${string}` }).rawTransaction;
    return result;
  } }));
  const wallet = await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] as Address, decimals: 6 },
    amount: "0.1" }) as { operation_id: string };
  const fence = t.mock.method(EvmDirectSubmissionJournal.prototype, "fence", async () => { throw new Error("simulated loss before dispatch"); });
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), /simulated loss before dispatch/u);
  fence.mock.restore();
  const saved = await setup.state.findOperation(prepared.operation_id);
  assert.equal(saved?.state, "signed_not_submitted"); assert.ok(signedRaw); assert.equal(saved?.rawTransactionHash, keccak256(signedRaw));
  const chain = mockEvmHttps(t, 8453, () => wallet.address); chain.receipts = receipts;
  let newSigns = 0;
  const invocation = () => new ApnCore({ state: new StateStore(temporary.root), rpc: new HttpsBaseRpc("https://8.8.8.8/rpc", { directGuardState: setup.state }),
    clock: setup.clock, native: { request: async request => {
      if (request.operation === "directTransfer.approveAndSign") newSigns++;
      return await setup.local.request(request);
    } } });
  const resumed = await invocation().transfer.resume(prepared.operation_id) as { state: string };
  assert.equal(resumed.state, receipts ? "completed" : "submitted_pending");
  assert.deepEqual(chain.sends, [signedRaw]); assert.equal(newSigns, 0);
  assert.deepEqual(chain.posts, [["eth_sendRawTransaction"], ["eth_chainId", "eth_getTransactionReceipt"],
    ...(receipts ? [["eth_getBlockByNumber", "eth_getTransactionByHash"]] : [])], "nothing is re-read between the saved signature and its one send");
  chain.posts.length = 0;
  await invocation().transfer.resume(prepared.operation_id);
  assert.equal(chain.sends.length, 1, "a dispatched signature the node still holds is observed, never re-sent");
  assert.deepEqual(chain.posts, receipts ? [] : [["eth_chainId", "eth_getTransactionReceipt"],
    ["eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash"]]);
});

for (const status of [429, 403]) test(`HTTP ${status} ends a direct step after its one POST`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const chain = mockEvmHttps(t, 1329, () => WALLET); chain.status = status;
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard(directEvmStepBudget(1329, "prepare"));
  const error = await rpc.evm.directReads(1329).balance(WALLET, { chainId: 1329, token: "native" }).then(() => undefined, (failure: unknown) => failure) as
    { code?: string; details?: { phase?: string; httpStatus?: number } } | undefined;
  assert.equal(error?.code, status === 429 ? "APN_RPC_RATE_LIMITED" : "APN_RPC_PROTOCOL");
  assert.equal(error?.details?.phase, "balance"); assert.equal(error?.details?.httpStatus, status);
  assert.equal(chain.posts.length, 1);
});

test("a substituted batch response id is refused after one POST, and the plan cap stops a runaway step", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts += 1;
      const batch = JSON.parse(body) as { id: number }[];
      const raw = JSON.stringify(batch.map(item => ({ jsonrpc: "2.0", id: item.id + 1000, result: "0x531" })));
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = 200;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); }; receive(response);
        response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard(2);
  await assert.rejects(rpc.evm.directReads(1329).balance(WALLET, { chainId: 1329, token: "native" }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(posts, 1);
  await assert.rejects(rpc.evm.directReads(1329).balance(WALLET, { chainId: 1329, token: "native" }), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(rpc.evm.directReads(1329).balance(WALLET, { chainId: 1329, token: "native" }), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(posts, 2);
});

