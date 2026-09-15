import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { MetaMaskGaslessRpc, metaMaskGaslessObservationRpcFactory, mmObservationRpcEnv } from "../../src/metamask-gasless/chain/rpc.js";
import type { MetaMaskGaslessRpcPort } from "../../src/metamask-gasless/ports.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { MmTestRpc, mmFixture, mmTestWord } from "./metamask-gasless-helpers.js";

const ENV = "APN_BASE_ARCHIVE_RPC_URL";
const ARCHIVE_URL = "https://archive.example/v2/private_archive_canary";

/** The synthetic chain evidence of MmTestRpc behind a different endpoint identity. */
function archiveRpc(now: Date) {
  const base = new MmTestRpc(8453, now);
  const rpc: MetaMaskGaslessRpcPort = { chainId: 8453, endpointOrigin: "https://archive.example", rpcUrl: ARCHIVE_URL,
    endpointHash: sha256(ARCHIVE_URL), balance: async () => await base.balance(), snapshot: async () => await base.snapshot(),
    observe: async (intent, cursor) => await base.observe(intent, cursor) };
  return { base, rpc };
}

class AnchorTransport implements GaslessTransport {
  readonly methods: string[] = [];
  constructor(private readonly chainId: bigint, private readonly blockHash: string) {}
  async request(_endpoint: string, _method: "POST" | "GET", body: string | null) {
    const request = JSON.parse(body!) as { readonly id: string; readonly method: string; readonly params: readonly unknown[] };
    this.methods.push(request.method);
    const result = request.method === "eth_chainId" ? `0x${this.chainId.toString(16)}`
      : request.method === "eth_getBlockByNumber" ? { number: request.params[0], hash: this.blockHash, timestamp: "0x1" } : null;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }
}

async function dispatched(root: string) {
  const f = await mmFixture(root); f.rpc.phase = "pending";
  const { id } = await f.prepare("mm-observation-rpc-0001");
  const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  const before = await f.record(id);
  assert.equal(before.terminal, false); assert.equal(before.submissionAttempts, 1);
  return { f, id, before };
}

test("MetaMask resume observes through an owner-named RPC after dispatch and saves only its redacted identity", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, id } = await dispatched(temporary.root);
  const archive = archiveRpc(f.now), requested: Array<readonly [number, string]> = [];
  const frozenObserves = f.rpc.calls.filter((call) => call === "observe").length;
  const submissions = f.provider.submissions.length;
  const core = new ApnCore({ state: new StateStore(temporary.root), clock: f.clock, metaMaskGasless: { ...f.dependencies,
    observationRpcFor: (chainId, environmentName) => { requested.push([chainId, environmentName]); return archive.rpc; } } });
  const result = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const after = await f.record(id);
  assert.equal(after.state, "completed");
  assert.deepEqual(after.observation?.source, { environmentName: ENV, endpointOrigin: "https://archive.example", endpointHash: sha256(ARCHIVE_URL) });
  assert.deepEqual(requested, [[8453, ENV]]);
  assert.deepEqual(archive.base.calls, ["observe"]);
  assert.equal(f.rpc.calls.filter((call) => call === "observe").length, frozenObserves);
  assert.equal(f.provider.submissions.length, submissions);
  assert.equal(JSON.stringify(after).includes("private_archive_canary"), false);
  assert.equal((await f.restart().execute({ command: "operation.status", operationId: id })).ok, true);
});

test("MetaMask observation RPC is ignored before approval and refused without a factory", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id } = await f.prepare("mm-observation-rpc-0002");
  let requested = 0;
  const core = new ApnCore({ state: new StateStore(temporary.root), clock: f.clock, metaMaskGasless: { ...f.dependencies,
    observationRpcFor: () => { requested += 1; return archiveRpc(f.now).rpc; } } });
  const waiting = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
  assert.equal(waiting.ok, true); assert.equal((await f.record(id)).state, "awaiting_approval"); assert.equal(requested, 0);

  const other = await temporaryState(); t.after(other.cleanup);
  const { f: g, id: dispatchedId } = await dispatched(other.root);
  const refused = await g.restart().execute({ command: "operation.resume", operationId: dispatchedId, observationRpcEnv: ENV });
  assert.equal(refused.ok, false); assert.equal(refused.error?.details?.reason, "mm_gasless_rpc_binding");
});

test("the MetaMask observation RPC proves chain and frozen anchor and never serves snapshots", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, before } = await dispatched(temporary.root);
  const build = (transport: GaslessTransport) => new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: ARCHIVE_URL, clock: f.clock, transport, observationOnly: true });
  const quiet = new AnchorTransport(8453n, before.intent.initialSnapshot.safeBlock.hash);
  await assert.rejects(build(quiet).balance(before.intent.binding.address), { details: { reason: "mm_gasless_rpc_binding" } });
  await assert.rejects(build(quiet).snapshot({ owner: before.intent.binding.address, delegationHash: before.intent.delegationHash,
    grossAtomic: before.intent.request.grossAtomic }), { details: { reason: "mm_gasless_rpc_binding" } });
  assert.deepEqual(quiet.methods, []);

  const wrongChain = new AnchorTransport(1n, before.intent.initialSnapshot.safeBlock.hash);
  await assert.rejects(build(wrongChain).observe(before.intent, before.cursor, null), { details: { reason: "mm_gasless_rpc_binding" } });
  assert.deepEqual(wrongChain.methods, ["eth_chainId"]);

  const forked = new AnchorTransport(8453n, mmTestWord("forked-anchor"));
  await assert.rejects(build(forked).observe(before.intent, before.cursor, null), { details: { reason: "mm_gasless_rpc_binding" } });
  assert.deepEqual(forked.methods, ["eth_chainId", "eth_getBlockByNumber"]);
});

test("MetaMask observation environment names are validated and never resolved to a missing URL", () => {
  for (const name of ["", "BASE_RPC_URL", "APN_base_RPC_URL", `APN_${"A".repeat(130)}_RPC_URL`, "APN_BASE_RPC_URL\n"]) {
    assert.throws(() => mmObservationRpcEnv(name), { details: { reason: "mm_gasless_input" } }, name);
  }
  assert.equal(mmObservationRpcEnv(ENV), ENV);
  const factory = metaMaskGaslessObservationRpcFactory({}, { now: () => new Date() });
  assert.throws(() => factory(8453, ENV), { details: { reason: "mm_gasless_rpc_binding" } });
  const rpc = metaMaskGaslessObservationRpcFactory({ [ENV]: ARCHIVE_URL }, { now: () => new Date() })(8453, ENV);
  assert.equal(rpc.endpointOrigin, "https://archive.example"); assert.equal(rpc.endpointHash, sha256(ARCHIVE_URL));
});
