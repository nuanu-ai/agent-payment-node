/**
 * SYNTHETIC, through the real CLI path: a CCTP V2 burn whose mint someone else relayed (destinationCaller zero). Observe
 * and approve-mint close an owned mint that never reached the network, find the relayer's transaction from transmitter
 * logs and adopt it in the same command; not found within the scan cap, they name the explicit adoption command. The
 * public network refuses every state read at a block other than a head (P1), as a pruned public node does.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CIRCLE_TRANSMITTER } from "../../src/circle-v2-evm/catalog.js";
import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { encodeCircleMint } from "../../src/circle-v2-evm/protocol.js";
import { advanceCircleFundingOperation, validateCircleFundingOperation, type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { block, fundingExternalFixture } from "./circle-funding-external-fixtures.js";

/** Destination block n is stamped 1899990000 + n, so the burn (Arbitrum block 10, stamped 1900000010) is at block 10010; the
 * attestation expires at destination block 100000. */
const LAYOUT = { mintBlock: 10_015, head: 20_000, timeBase: 1_899_990_000, expiry: 100_000n };
type Fixture = Awaited<ReturnType<typeof fundingExternalFixture>>;
interface Notice { status: string; destination_chain: number; transmitter: string; message_nonce: string; transaction_hash: string | null; scan: { from_block: string; to_block: string; head_block: string; log_window_blocks: number; log_requests: number; header_requests: number } | null; }
interface Out { state: string; terminal: boolean; next_actions: string[]; external_mint?: Notice; actual_economics?: Record<string, unknown>; effects: { role: string; phase: string; transaction_hash: string | null }[]; }
const cli = (f: Fixture, action: string, extra: string[] = []) => runCli(["circle", "evm", action, "--operation", f.op.operationId, ...extra], {}, { stateRoot: f.root, circleFundingEvm: f.service, wrappingSecret: f.secret });
async function fixture(t: test.TestContext, layout: Partial<typeof LAYOUT> = {}) { const f = await fundingExternalFixture(false, 71n, { ...LAYOUT, ...layout }); t.after(() => rm(f.root, { recursive: true, force: true })); return f; }
async function journal(f: Fixture): Promise<CircleFundingOperationV2> { const op = await f.repo.loadAny(f.op.operationId); assert.ok(op?.schemaVersion === "apn.circle-v2-evm-operation.v2"); return validateCircleFundingOperation(op); }
async function holds(f: Fixture) { const ledger = new AssetUsageLedger(f.root); return Promise.all(f.op.usage.map(async row => (await ledger.load(row, row.reservationId))!.state)); }
function noEffects(f: Fixture) { assert.ok(!f.calls.some(m => /send|estimate|maxPriority|eth_getCode|eth_getStorageAt/u.test(m)), f.calls.join(",")); assert.deepEqual(f.historical, []); }
async function adopted(f: Fixture, out: Out) {
  assert.equal(out.state, "external_fulfilled"); assert.equal(out.terminal, true); assert.deepEqual(out.next_actions, []);
  assert.equal(out.external_mint?.status, "adopted"); assert.equal(out.external_mint?.transaction_hash, f.txHash);
  const done = await journal(f); assert.equal(done.externalFulfillment!.destinationReceipt.transactionHash, f.txHash); assert.equal(done.externalFulfillment!.netAtomic, "509929");
  // An external mint reports the same actual economics an owned one does, from the adopted proof.
  assert.equal(out.actual_economics?.destination_mint, "external"); assert.equal(out.actual_economics?.actual_destination_net_atomic, "509929");
  assert.equal(out.actual_economics?.actual_issuer_fee_atomic, done.externalFulfillment!.issuerFeeAtomic); assert.equal(out.actual_economics?.destination_mint_transaction_hash, f.txHash);
  assert.deepEqual(await holds(f), ["finalized", "finalized", "finalized", "released_unsubmitted", "released_unsubmitted"]); return done;
}
/** An owned mint signed at the gas payer's nonce 3 whose broadcast answer was lost: the node knows neither its hash nor a receipt. */
async function lostOwnedMint(f: Fixture) {
  const e = circleEnvelope({ chainId: 143, from: f.op.destinationCustody.walletAddress, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(f.op.attestation!), valueAtomic: "0", nonceAtomic: "3", gasLimitAtomic: "500000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" });
  const lost = `0x${"5".repeat(64)}` as const; let op = f.op;
  for (const [phase, reason] of [["prepared", "mint_envelope_frozen"], ["signing_started", "mint_signing_fence"], ["sealed", "mint_material_sealed"], ["submission_started", "mint_submission_fence"], ["unknown", "mint_fenced_unknown_observe_only"]] as const) {
    const signed = !["prepared", "signing_started"].includes(phase);
    op = advanceCircleFundingOperation(op, { state: phase === "prepared" ? "awaiting_mint" : "mint_unknown", effects: [...op.effects.filter(x => x.role !== "mint"), { role: "mint", phase, envelope: e, transactionHash: signed ? lost : null, materialHash: signed ? "6".repeat(64) : null, proof: null }] }, reason, Date.parse(f.op.preparedAt));
    await f.repo.saveFunding(op);
  }
  const dir = join(f.root, "circle-v2-evm-funding-effects"); await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const suffix of ["", "-sign", "-send"]) await writeFile(join(dir, `${f.op.operationId}-mint${suffix}.json`), "{}", { mode: 0o600 });
  return { lost, material: join(dir, `${f.op.operationId}-mint.json`), claims: ["-sign", "-send"].map(s => join(dir, `${f.op.operationId}-mint${s}.json`)) };
}

test("the synthetic public network refuses state reads at an old block, as the P1 assertions below rely on", async t => {
  const f = await fixture(t), body = (tag: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CIRCLE_TRANSMITTER, data: "0x5c975abb" }, tag] });
  for (const tag of ["0xa", { blockHash: `0x${"1".repeat(64)}`, requireCanonical: true }]) assert.match((await f.publicNetwork.request("https://monad.example/", "POST", body(tag))).body, /historical state is not available/);
  assert.equal(f.historical.length, 2); assert.doesNotMatch((await f.publicNetwork.request("https://monad.example/", "POST", body("latest"))).body, /error/);
});

test("no owned attempt: observe finds the relayed mint from transmitter logs and adopts it in the same command", async t => {
  const f = await fixture(t), result = await cli(f, "observe"); assert.equal(result.ok, true, JSON.stringify(result));
  const out = result.operation as Out; await adopted(f, out);
  const scan = out.external_mint!.scan!; assert.deepEqual({ ...scan, header_requests: 0 }, { from_block: "9950", to_block: "10049", head_block: "20000", log_window_blocks: 100, log_requests: 1, header_requests: 0 });
  assert.ok(scan.header_requests >= 1 && scan.header_requests <= 6, `${scan.header_requests} header reads`);
  assert.deepEqual(f.logWindows.map(w => [w.from, w.to]), [[9_950n, 10_049n]]); noEffects(f);
  const calls = f.calls.length; assert.equal((await cli(f, "observe")).ok, true); assert.equal(f.calls.length, calls, "a terminal operation reads nothing");
});

test("an owned mint that never reached the network is closed, its bytes discarded, and the relayed mint adopted", async t => {
  const f = await fixture(t), own = await lostOwnedMint(f), result = await cli(f, "observe"); assert.equal(result.ok, true, JSON.stringify(result));
  const done = await adopted(f, result.operation as Out), mint = done.effects.find(e => e.role === "mint")!;
  assert.equal(mint.phase, "abandoned_unsent"); assert.equal(mint.transactionHash, own.lost);
  assert.ok(done.transitions.some(x => x.reason === "mint_closed_issuer_message_used_externally"));
  await assert.rejects(access(own.material), { code: "ENOENT" }); for (const claim of own.claims) await access(claim);
  for (const method of ["eth_getTransactionCount", "eth_getLogs"]) assert.ok(f.calls.includes(method), method); noEffects(f);
});

test("approve-mint on a message someone else minted asks no consent and signs nothing: it adopts the relayed mint", async t => {
  const f = await fixture(t), result = await cli(f, "approve-mint"); assert.equal(result.ok, true, JSON.stringify(result));
  await adopted(f, result.operation as Out); noEffects(f);
});

test("not found within the scan cap: an explicit adopt-external-mint next action, the operation otherwise unchanged", async t => {
  // The relayed mint lies past the 64 windows of 100 blocks the command may scan from block 9950.
  const f = await fixture(t, { mintBlock: 16_915 });
  for (const action of ["observe", "approve-mint"]) {
    const result = await cli(f, action); assert.equal(result.ok, true, JSON.stringify(result)); const out = result.operation as Out;
    assert.equal(out.state, "awaiting_mint"); assert.equal(out.terminal, false);
    assert.deepEqual(out.next_actions, [`apn circle evm adopt-external-mint --operation ${f.op.operationId} --transaction-hash <transaction-hash>`]); assert.deepEqual(result.next_actions, out.next_actions);
    const n = out.external_mint!; assert.equal(n.status, "not_found"); assert.equal(n.destination_chain, 143); assert.equal(n.transmitter, CIRCLE_TRANSMITTER); assert.equal(n.message_nonce, f.attestation.nonce); assert.equal(n.transaction_hash, null);
    assert.deepEqual([n.scan!.from_block, n.scan!.to_block, n.scan!.log_requests], ["9950", "16349", 64]);
    assert.equal((await journal(f)).integrityHash, f.op.integrityHash); assert.deepEqual(await holds(f), f.op.usage.map(() => "unknown_finality"));
  }
  assert.equal(f.logWindows.length, 128); f.logWindows.forEach((w, i) => { assert.equal(w.to - w.from, 99n); assert.equal(w.from, 9_950n + 100n * BigInt(i % 64)); }); noEffects(f);
  const explicit = await cli(f, "adopt-external-mint", ["--transaction-hash", f.txHash]); assert.equal(explicit.ok, true, JSON.stringify(explicit));
  assert.equal((explicit.operation as Out).state, "external_fulfilled"); noEffects(f);
});

test("a relayed mint the destination SAFE head has not reached stays found; the next observe adopts it", async t => {
  const f = await fixture(t), original = f.publicNetwork.request.bind(f.publicNetwork);
  const lagging = t.mock.method(f.publicNetwork, "request", async (url: string, method: unknown, body: string | null) => {
    const response = await original(url, method, body); if (url.includes("arbitrum")) return response;
    const request = JSON.parse(body!), answer = JSON.parse(response.body), fix = (r: { method: string; params: unknown[] }, a: Record<string, unknown>) =>
      r.method === "eth_getBlockByNumber" && r.params[0] === "safe" ? { ...a, result: block(10_010, [], undefined, LAYOUT.timeBase) } : a;
    return { ...response, body: JSON.stringify(Array.isArray(request) ? answer.map((a: Record<string, unknown>, i: number) => fix(request[i], a)) : fix(request, answer)) };
  });
  const first = await cli(f, "observe"); assert.equal(first.ok, true, JSON.stringify(first)); const out = first.operation as Out;
  assert.equal(out.state, "awaiting_mint"); assert.equal(out.external_mint?.status, "found_awaiting_finality"); assert.equal(out.external_mint?.transaction_hash, f.txHash);
  assert.deepEqual(out.next_actions, [`apn circle evm observe --operation ${f.op.operationId}`]); assert.equal((await journal(f)).integrityHash, f.op.integrityHash);
  lagging.mock.restore(); const second = await cli(f, "observe"); assert.equal(second.ok, true, JSON.stringify(second)); await adopted(f, second.operation as Out); noEffects(f);
});

test("an unused issuer message is not scanned: observe leaves the awaiting mint as it is and names approve-mint", async t => {
  const f = await fixture(t); f.chain.usedNonce = 0n;
  const result = await cli(f, "observe"); assert.equal(result.ok, true, JSON.stringify(result)); const out = result.operation as Out;
  // QA 0.5.51 CIRCLE-NEXT-ACTION-001: a verified burn and attestation wait for the owner's mint, not for another observe.
  assert.equal(out.state, "awaiting_mint"); assert.equal(out.external_mint, undefined); assert.deepEqual(out.next_actions, [`apn circle evm approve-mint --operation ${f.op.operationId}`]);
  assert.ok(!f.calls.includes("eth_getLogs")); assert.equal((await journal(f)).integrityHash, f.op.integrityHash); noEffects(f);
});
