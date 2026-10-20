import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import type { ChainAccount, RailSignedEffect } from "../../src/direct-rail-ports.js";
import { ApnError } from "../../src/errors.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { SolanaRpcPacer } from "../../src/solana/pacing.js";
import { StateStore } from "../../src/state.js";
import type { SwapOperationRecord } from "../../src/swap/model.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { orcaStableLegacyFinisher } from "../../src/legacy/orca-stable/finisher.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";
import { temporaryState } from "./helpers.js";

/**
 * SWAP-10: the stable USDC to USDT creation path is gone; operations APN 0.5.45 wrote in every non-terminal state still
 * finish through the frozen exits. Each case is the exact bytes the released writer produced (tests/fixtures).
 */
const CASES = join("tests", "fixtures", "orca-stable-legacy");
const ENDPOINT = "https://stable-source.example/rpc", LAST_VALID = 400_000_100n;
interface LegacyCase { readonly operationId: string; readonly state: string; readonly account: ChainAccount; readonly effect: RailSignedEffect | null;
  readonly finalizedStatuses?: unknown; readonly finalizedTransaction?: unknown }
const reason = (error: unknown) => error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error);

async function legacy(t: test.TestContext, name: string) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await installLegacyCase(join(CASES, name, "state"), temporary.root);
  const fixture = JSON.parse(await readFile(join(CASES, name, "case.json"), "utf8")) as LegacyCase;
  const state = new StateStore(temporary.root); await state.initialize();
  let time = Date.parse("2026-10-17T10:00:00.000Z"), prompts = 0, height = LAST_VALID;
  let statuses: unknown = { context: { slot: 450_687_950 }, value: [null] }, transaction: unknown = null;
  const methods: string[] = [];
  // A block height is read as a JSON-RPC array beside the finalized latest blockhash (solana/rpc.ts).
  const fetcher: typeof fetch = async (_url, init) => {
    const parsed = JSON.parse(init!.body as string) as { id: string; method: string } | { id: string; method: string }[];
    const answer = (body: { id: string; method: string }) => {
      methods.push(body.method);
      const result = body.method === "getGenesisHash" ? SOLANA_GENESIS : body.method === "getBlockHeight" ? Number(height) :
        body.method === "getLatestBlockhash" ? { context: { slot: 450_687_950 }, value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: Number(height) + 150 } } :
        body.method === "getSignatureStatuses" ? statuses : body.method === "getTransaction" ? transaction : assert.fail(`unexpected ${body.method}`);
      return { jsonrpc: "2.0", id: body.id, result };
    };
    return new Response(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)), { status: 200, headers: { "content-type": "application/json" } });
  };
  const clock = { now: () => new Date(time) };
  const custody = { account: async () => fixture.account, effectByOperationId: async () => fixture.effect } as never;
  const finisher = () => orcaStableLegacyFinisher({ root: temporary.root, clock, accounts: custody, consent: { confirm: async () => { prompts += 1; } },
    rpc: new SolanaRpc(ENDPOINT, fetcher, new SolanaRpcBudget({ maxPhysicalRequests: 24, minimumIntervalMs: 750, now: () => time,
      wait: async (ms) => { time += ms; } }), new SolanaRpcPacer(state, () => time, async (ms) => { time += ms; })) });
  const operation = async () => (await new SwapOperationRepository(temporary.root).loadAny(fixture.operationId))!;
  const lease = async (record: SwapOperationRecord) => await new AssetUsageLedger(temporary.root).load({ account: record.quote.account,
    chain: record.quote.sourceAsset.chain, asset: { kind: "token", identifier: record.quote.sourceAsset.identifier! } }, record.usageLease!.reservationId);
  return { root: temporary.root, fixture, finisher, operation, lease, methods, custody, fetcher, clock, prompts: () => prompts,
    setHeight: (value: bigint) => { height = value; }, finalize: () => { statuses = fixture.finalizedStatuses; transaction = fixture.finalizedTransaction; },
    sends: () => methods.filter((method) => method === "sendTransaction").length, advance: (ms: number) => { time += ms; } };
}

test("every golden stable record was written in its state by APN 0.5.45", async (t) => {
  for (const [name, state] of [["prepared", "prepared"], ["awaiting-approval", "awaiting_approval"], ["reserved", "reserved"],
    ["submitting-unsigned", "submitting"], ["submitting-signed-unclaimed", "submitting"], ["submitting-claimed", "submitting"], ["submitted", "submitted"]]) {
    const l = await legacy(t, name!);
    assert.equal((await l.operation()).state, state, name); assert.equal(l.fixture.state, state);
  }
});

test("prepared and awaiting_approval: status releases the expired unsigned preparation, release is idempotent", async (t) => {
  const prepared = await legacy(t, "prepared");
  const released = await prepared.finisher().release(prepared.fixture.operationId) as { operation: SwapOperationRecord };
  assert.equal(released.operation.state, "failed_before_effect"); assert.equal(released.operation.usageLease, null);
  assert.deepEqual(await prepared.finisher().release(prepared.fixture.operationId), released);
  const awaiting = await legacy(t, "awaiting-approval");
  const status = await awaiting.finisher().status(awaiting.fixture.operationId) as { operation: SwapOperationRecord; executable: boolean };
  assert.equal(status.operation.state, "failed_before_effect"); assert.equal(status.executable, false);
  assert.equal(awaiting.methods.length + prepared.methods.length, 0, "no RPC");
});

test("reserved: release returns the exact USDC principal and the daily usage", async (t) => {
  const l = await legacy(t, "reserved"), before = await l.operation();
  assert.equal((await l.lease(before))?.state, "reserved");
  const released = await l.finisher().release(l.fixture.operationId) as { operation: SwapOperationRecord };
  assert.equal(released.operation.state, "failed_before_effect"); assert.equal(released.operation.usageLease?.state, "failed_before_effect");
  assert.equal((await l.lease(before))?.state, "failed_before_effect");
  assert.equal((await new AssetUsageLedger(l.root).usage({ account: before.quote.account, chain: before.quote.sourceAsset.chain,
    asset: { kind: "token", identifier: before.quote.sourceAsset.identifier! } }, l.clock.now())).amountAtomic, "0");
  assert.equal(l.methods.length, 0);
});

test("submitting before signing: one owner consent proves no send and releases the principal; release and observe refuse", async (t) => {
  const l = await legacy(t, "submitting-unsigned");
  await assert.rejects(l.finisher().release(l.fixture.operationId), (error) => reason(error) === "orca_stable_effect_boundary");
  await assert.rejects(l.finisher().observe(l.fixture.operationId), (error) => error instanceof ApnError &&
    reason(error) === "orca_stable_effect_boundary" && (error.details?.nextActions as string[])[0]!.includes("stable-recover-no-send"));
  const recovered = await l.finisher().recoverNoSend(l.fixture.operationId);
  assert.equal(recovered.state, "failed_before_effect"); assert.equal(recovered.usageLease?.state, "failed_before_effect");
  assert.equal(l.prompts(), 1, "exactly one owner consent");
  assert.equal((await l.finisher().recoverNoSend(l.fixture.operationId)).integrityHash, recovered.integrityHash);
  assert.equal(l.sends(), 0);
});

test("submitting, signed but never claimed: no local release; observation expires it once the bound blockhash passed", async (t) => {
  const l = await legacy(t, "submitting-signed-unclaimed");
  await assert.rejects(l.finisher().recoverNoSend(l.fixture.operationId), (error) => error instanceof ApnError &&
    reason(error) === "orca_stable_signed_effect_exists" && (error.details?.nextActions as string[])[0]!.includes("stable-observe"));
  assert.equal((await l.finisher().observe(l.fixture.operationId)).state, "submitting", "lifetime still open: nothing changes");
  l.setHeight(LAST_VALID + 1n);
  const expired = await l.finisher().observe(l.fixture.operationId);
  assert.equal(expired.state, "expired_unlanded"); assert.equal(expired.usageLease?.state, "released_unsubmitted");
  assert.equal((await l.lease(expired))?.state, "released_unsubmitted");
  assert.equal((await l.finisher().observe(l.fixture.operationId)).integrityHash, expired.integrityHash);
  assert.equal((await l.finisher().status(l.fixture.operationId) as { phase: string }).phase, "expired_unlanded");
  assert.deepEqual(l.methods, ["getGenesisHash", "getBlockHeight", "getLatestBlockhash", "getGenesisHash", "getBlockHeight", "getLatestBlockhash"]);
});

test("submitting with a claim: recovery refuses; observation records the possible send, then expiry or finality settles it", async (t) => {
  const l = await legacy(t, "submitting-claimed");
  await assert.rejects(l.finisher().recoverNoSend(l.fixture.operationId), (error) => reason(error) === "orca_stable_send_claim_exists");
  const pending = await l.finisher().observe(l.fixture.operationId);
  assert.equal(pending.state, "unknown_finality"); assert.equal((await l.lease(pending))?.state, "unknown_finality");
  l.setHeight(LAST_VALID + 1n);
  const expired = await l.finisher().observe(l.fixture.operationId);
  assert.equal(expired.state, "expired_unlanded"); assert.equal((await l.lease(expired))?.state, "released_unsubmitted");
  const final = await legacy(t, "submitting-claimed"); final.finalize();
  assert.equal((await final.finisher().observe(final.fixture.operationId)).state, "finalized");
  assert.equal(l.sends() + final.sends(), 0);
});

test("submitted: the factory's stable-observe finalizes the claimed signature and replays without RPC", async (t) => {
  const l = await legacy(t, "submitted"); l.finalize();
  const request = bindArgv(["swap", "solana", "orca", "stable-observe", "--operation", l.fixture.operationId]);
  let time = l.clock.now().getTime();
  const run = async () => await createApnCore(request, { stateRoot: l.root, chainAccounts: l.custody, solanaRpcUrl: ENDPOINT,
    solanaRpcFetch: l.fetcher, solanaRpcNow: () => time, solanaRpcWait: async (ms) => { time += ms; }, clock: { now: () => new Date(time) } })
    .execute(request.request);
  const finalized = await run();
  assert.equal(finalized.ok, true, JSON.stringify(finalized.error));
  assert.equal((finalized.data as SwapOperationRecord).state, "finalized");
  assert.equal((await l.lease(await l.operation()))?.state, "finalized");
  const calls = l.methods.length;
  assert.equal(((await run()).data as SwapOperationRecord).state, "finalized");
  assert.deepEqual(l.methods, ["getGenesisHash", "getSignatureStatuses", "getTransaction"]);
  assert.equal(l.methods.length, calls, "a finalized replay reads nothing from the chain");
  assert.equal(l.sends(), 0);
});

test("submitted: a finalized revert releases the principal; the keyless commands point a legacy operation at its exits", async (t) => {
  const l = await legacy(t, "submitted"); l.finalize();
  const fixture = l.fixture as { finalizedStatuses: { value: { err: unknown }[] }; finalizedTransaction: { meta: Record<string, unknown> } };
  const error = { InstructionError: [2, { Custom: 6000 }] }, meta = fixture.finalizedTransaction.meta;
  fixture.finalizedStatuses.value[0]!.err = error;
  fixture.finalizedTransaction.meta = { ...meta, err: error, innerInstructions: [], postTokenBalances: meta.preTokenBalances,
    postBalances: [(meta.preBalances as number[])[0]! - (meta.fee as number), ...(meta.preBalances as number[]).slice(1)] };
  const reverted = await l.finisher().observe(l.fixture.operationId);
  assert.equal(reverted.state, "failed_confirmed_revert"); assert.equal((await l.lease(reverted))?.state, "failed_confirmed_revert");
  const core = new ApnCore({ state: new StateStore(l.root), clock: l.clock });
  for (const command of ["swap.orca.status", "swap.orca.approve", "swap.orca.execute"] as const) {
    const refused = await core.execute({ command, operationId: l.fixture.operationId });
    assert.equal(refused.error?.details?.reason, "orca_mechanism_mismatch");
    assert.ok(refused.next_actions.some((action) => action.includes("stable-status")));
  }
});
