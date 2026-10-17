import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Hex } from "viem";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { runCli } from "../../src/cli.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { GaslessUsdtCommandExecute } from "../../src/gasless-usdt/command-execute.js";
import { GaslessUsdtCommandPrepare } from "../../src/gasless-usdt/command-prepare.js";
import { UsdtExecutionJournal, usdtExecutionIntent } from "../../src/gasless-usdt/execution-journal.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { GaslessUsdtOperationService } from "../../src/gasless-usdt/service.js";
import { OperationService } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { v2Fixture, V2_NOW, V2_OWNER, V2Wrapping, V2_RECIPIENT } from "./gasless-usdt-v2-fixture.js";

const HASH = `0x${"ab".repeat(32)}` as Hex;
const identity = { account: V2_OWNER, chain: USDT_GASLESS.chain, asset: { kind: "token" as const, identifier: USDT_GASLESS.token } };
const prepareInput = (idempotencyKey: string) => ({ command: "gasless.usdt.prepare" as const, profile: "owner", recipient: V2_RECIPIENT,
  grossAtomic: "1000000", maxFeeAtomic: "999999", minReceivedAtomic: "1", idempotencyKey });

async function usdt(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root, { lockWaitMs: 1_000 }); await state.initialize();
  const f = v2Fixture("expected"), repository = new UsdtBoundOperationRepository(state.root), journal = new UsdtExecutionJournal(state.root);
  const bound = async (key: string) => await repository.create(allowlistProfileHash("owner"),
    await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request), key, f.now());
  const prepare = new GaslessUsdtCommandPrepare(state, { now: f.now }, new GaslessUsdtOperationService(state.root),
    { preparePort: f.prepare, sponsorPort: f.sponsor });
  return { temporary, state, f, bound, journal, prepare, operations: new OperationService(state) };
}

test("a USDT execution that can still land holds evm:1 for every family; a bound preparation or a retired one does not", async t => {
  const s = await usdt(t), op = await s.bound("hold-001");
  await s.operations.assertEvmAccountAvailable(s.state.profileHash("owner"), 1, V2_OWNER);
  await s.journal.reserve(op, usdtExecutionIntent(op), s.f.prepare);
  await s.journal.markSubmitting(op, s.f.prepare, HASH);
  for (const profile of ["owner", "another-profile"]) {
    await assert.rejects(s.operations.assertEvmAccountAvailable(s.state.profileHash(profile), 1, V2_OWNER), {
      code: "APN_OPERATION_BLOCKED", message: "Another money operation for this network and account is not terminal." });
  }
  await assert.rejects(s.operations.assertEvmAccountAvailable(s.state.profileHash("owner"), 1, V2_OWNER),
    (error: { details: Record<string, unknown> }) => error.details.blockingOperationId === op.operationId &&
      error.details.blockingState === "submitting" && error.details.blockingNetwork === "evm:1" &&
      error.details.blockingAccount === V2_OWNER.toLowerCase());
  await s.operations.assertEvmAccountAvailable(s.state.profileHash("owner"), 8453, V2_OWNER);
  // A store's own in-flight temporary is not a record; anything else unexpected fails closed.
  const directory = join(s.state.root, "gasless-usdt-executions");
  await writeFile(join(directory, `.${"a".repeat(12)}.${"b".repeat(24)}.tmp`), "{}", { mode: 0o600 });
  await assert.rejects(s.operations.assertEvmAccountAvailable(s.state.profileHash("owner"), 1, V2_OWNER), { code: "APN_OPERATION_BLOCKED" });
  await mkdir(join(directory, "unexpected"));
  await assert.rejects(s.operations.assertEvmAccountAvailable(s.state.profileHash("owner"), 1, V2_OWNER), { code: "APN_STATE_CORRUPT" });
});

test("USDT prepare and execute refuse an Ethereum account another operation holds, before any read or prompt", async t => {
  const s = await usdt(t), held = await s.bound("hold-002");
  await s.journal.reserve(held, usdtExecutionIntent(held), s.f.prepare);
  const reads = s.f.state.snapshots;
  await assert.rejects(s.prepare.prepare(prepareInput("blocked-prepare-001")), (error: { code: string; details: Record<string, unknown> }) =>
    error.code === "APN_OPERATION_BLOCKED" && error.details.blockingOperationId === held.operationId);
  assert.equal(s.f.state.snapshots, reads, "no safe snapshot or sponsor read after a refused account");
  const waiting = await s.bound("waiting-001"); let prompts = 0, sends = 0;
  const execute = new GaslessUsdtCommandExecute(s.state, { now: s.f.now }, new V2Wrapping(), { preparePort: s.f.prepare,
    approval: { approve: async () => { prompts++; } }, sendTransport: { send: async () => { sends++; return HASH; } } });
  await assert.rejects(execute.execute(waiting.profileHash, waiting.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(prompts, 0); assert.equal(sends, 0);
  assert.equal(await s.journal.load(waiting.operationId), null);
});

test("USDT prepare refuses an idempotency key another money family already bound", async t => {
  const s = await usdt(t);
  await (await gaslessFixture(s.state.root)).prepare("shared-key-0001");
  await assert.rejects(s.prepare.prepare(prepareInput("shared-key-0001")), (error: { code: string; details: Record<string, unknown> }) =>
    error.code === "APN_IDEMPOTENCY_CONFLICT" && error.details.reason === "gasless_usdt_idempotency_other_family");
  assert.equal(s.f.state.snapshots, 0);
  assert.equal((await s.prepare.prepare(prepareInput("usdt-own-key-0001"))).schemaVersion, "apn.gasless-usdt-bound-operation.v2");
});

test("gasless usdt resume reads the live journal: prepared, interrupted, submitted and finished operations", async t => {
  const s = await usdt(t), stateRoot = s.state.root, profileHash = allowlistProfileHash("owner");
  const prepared = await runCli(["gasless", "usdt", "prepare", "--profile", "owner", "--to", V2_RECIPIENT, "--amount", "1",
    "--max-fee", "0.999999", "--min-received", "0.000001", "--idempotency-key", "cli-resume-001"], {},
  { stateRoot, clock: { now: s.f.now }, gaslessUsdtPrepareOptions: { preparePort: s.f.prepare, sponsorPort: s.f.sponsor } });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const resume = async (now: Date, scan = false) => await runCli(["gasless", "usdt", "resume", "--profile-hash", profileHash,
    "--operation", operationId], {}, { stateRoot, clock: { now: () => now }, gaslessUsdtExecuteOptions: { recoveryPort: {
    userOperationReceipt: async () => null, canonicalFinalizedReceipt: async () => null,
    scanUserOperation: async () => ({ status: "not_found" as const, final: scan, finalizedBlock: 26_010_000n, endBlock: 26_002_976n,
      endBlockHash: `0x${"ee".repeat(32)}` as Hex }) } } });
  const bound = await resume(V2_NOW);
  assert.equal(bound.ok, true, JSON.stringify(bound.error));
  assert.equal((bound.operation as { operationId: string; state?: string }).operationId, operationId);
  const op = (await new UsdtBoundOperationRepository(stateRoot).load(profileHash, operationId))!;
  await s.journal.reserve(op, usdtExecutionIntent(op), s.f.prepare);
  const retired = await resume(V2_NOW);
  assert.equal((retired.operation as { state: string }).state, "failed_before_effect", "an interrupted unsent attempt is retired");
  assert.equal((await new AssetUsageLedger(stateRoot).usage(identity, V2_NOW)).amountAtomic, "0");

  const second = await s.bound("resume-submitted-001");
  await s.journal.reserve(second, usdtExecutionIntent(second), s.f.prepare);
  await s.journal.markSubmitting(second, s.f.prepare, HASH);
  const observe = new GaslessUsdtCommandExecute(s.state, { now: () => new Date(V2_NOW.getTime() + 400_000) }, new V2Wrapping(), {
    recoveryPort: { userOperationReceipt: async () => null, canonicalFinalizedReceipt: async () => null,
      scanUserOperation: async () => ({ status: "not_found" as const, final: true, finalizedBlock: 26_010_000n, endBlock: 26_002_976n,
        endBlockHash: `0x${"ee".repeat(32)}` as Hex }) } });
  const closed = await observe.resume(second.profileHash, second.operationId);
  assert.equal((closed as { state: string }).state, "expired_never_landed");
  assert.deepEqual(await observe.resume(second.profileHash, second.operationId), closed, "a terminal record is returned as saved");
});
