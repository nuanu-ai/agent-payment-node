import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Hex } from "viem";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { UsdtBoundOperationRepository, validateUsdtAnyBoundOperation, type UsdtAnyBoundOperation } from "../../src/gasless-usdt/bound-operation.js";
import { GaslessUsdtCommandExecute } from "../../src/gasless-usdt/command-execute.js";
import { UsdtExecutionJournal, usdtExecutionIntent } from "../../src/gasless-usdt/execution-journal.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { UsdtRecoveryService } from "../../src/gasless-usdt/recovery.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { v2Fixture, V2_NOW, V2_OWNER, V2Wrapping } from "./gasless-usdt-v2-fixture.js";

const HASH = `0x${"ab".repeat(32)}` as Hex;
const AFTER_VALIDITY = new Date(V2_NOW.getTime() + 400_000);
const identity = { account: V2_OWNER, chain: USDT_GASLESS.chain, asset: { kind: "token" as const, identifier: USDT_GASLESS.token } };

/**
 * A bound record exactly as an earlier release would have written it under a different sponsor constant: every own hash
 * is consistent, but the record no longer matches the current USDT_GASLESS pins.
 */
async function earlierRelease(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const f = v2Fixture("expected"), profileHash = allowlistProfileHash("owner"), repository = new UsdtBoundOperationRepository(state.root);
  const current = await repository.create(profileHash, await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request),
    "earlier-release-001", f.now());
  const record = JSON.parse(JSON.stringify(current)) as Record<string, any>;
  record.binding.sponsorUrl = "https://public.pimlico.io/v2/1/rpc-earlier-release";
  const { bindingHash: _binding, ...bindingBody } = record.binding; record.binding.bindingHash = hashObject(bindingBody);
  record.operationId = hashObject({ schemaVersion: record.schemaVersion, profileHash, idempotencyKey: record.idempotencyKey,
    bindingHash: record.binding.bindingHash });
  const { integrityHash: _integrity, ...body } = record; record.integrityHash = hashObject(body);
  await writeFile(join(repository.directory, profileHash, `${record.operationId}.json`), `${canonicalJson(record)}\n`, { mode: 0o600 });
  const legacy = (await repository.load(profileHash, record.operationId as string))!;
  return { state, f, profileHash, legacy, record };
}

test("a bound record written under other constants still loads for status and resume; execute refuses it before any prompt", async t => {
  const s = await earlierRelease(t);
  assert.throws(() => validateUsdtAnyBoundOperation(s.record), "the record no longer matches the current pins");
  assert.deepEqual(s.legacy, s.record);
  const argv = (action: string) => ["gasless", "usdt", action, "--profile-hash", s.profileHash, "--operation", s.legacy.operationId];
  for (const action of ["status", "resume", "execution-status"]) {
    const outcome = await runCli(argv(action), {}, { stateRoot: s.state.root, clock: { now: s.f.now } });
    assert.equal(outcome.ok, true, `${action}: ${JSON.stringify(outcome.error)}`);
  }
  let prompts = 0;
  const execute = new GaslessUsdtCommandExecute(s.state, { now: s.f.now }, new V2Wrapping(), { preparePort: s.f.prepare,
    approval: { approve: async () => { prompts++; } }, sendTransport: { send: async () => HASH } });
  await assert.rejects(execute.execute(s.profileHash, s.legacy.operationId), (error: { code: string; details: Record<string, unknown> }) =>
    error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "gasless_usdt_protocol_changed");
  assert.equal(prompts, 0);
});

test("a submitted record written under other constants is still observed and can reach its never-landed exit", async t => {
  const s = await earlierRelease(t), legacy = s.legacy as UsdtAnyBoundOperation;
  const lease = await new AssetUsageLedger(s.state.root).reserve({ ...identity, registry: s.f.state.current!.registry, rail: "gasless",
    amountAtomic: "1000000", idempotencyKey: `gasless-usdt-execution:${legacy.operationId}`, now: s.f.now() });
  const at = s.f.now().toISOString();
  const body = { schemaVersion: "apn.gasless-usdt-execution.v1", ...usdtExecutionIntent(legacy), reservationId: lease.reservationId,
    state: "submitting", userOperationHash: HASH, createdAt: at, updatedAt: at };
  await mkdir(join(s.state.root, "gasless-usdt-executions"), { mode: 0o700 });
  await writeFile(join(s.state.root, "gasless-usdt-executions", `${legacy.operationId}.json`),
    `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`, { mode: 0o600 });
  const journal = new UsdtExecutionJournal(s.state.root);
  const closed = await new UsdtRecoveryService(journal, { userOperationReceipt: async () => null, canonicalFinalizedReceipt: async () => null,
    scanUserOperation: async () => ({ status: "not_found", final: true, finalizedBlock: 26_010_000n, endBlock: 26_002_976n,
      endBlockHash: `0x${"ee".repeat(32)}` }) }, () => AFTER_VALIDITY).observe(legacy);
  assert.equal(closed.state, "expired_never_landed");
  assert.equal((await new AssetUsageLedger(s.state.root).load(identity, lease.reservationId))?.state, "released_unsubmitted");
  assert.match(await readFile(join(s.state.root, "gasless-usdt-executions", `${legacy.operationId}.json`), "utf8"), /expired_never_landed/u);
});
