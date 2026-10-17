import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { operationRegistry } from "../../src/operation-index/registry.js";
import type { OperationFamily } from "../../src/operation-index/types.js";
import { StateStore } from "../../src/state.js";
import { CanonicalDirectTestNative } from "./canonical-direct-native-fixture.js";
import { ensureWallet, makeCore, prepareTransfer, temporaryState, TestClock, TestNative, TestRpc, UUID } from "./helpers.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation } from "./x402-helpers.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { X402_PAYMENT_REQUIRED, X402_URL, canonicalPaymentRequiredHeader } from "./x402-vectors.js";

/**
 * Phase 4b WP3 (CORE-17): `apn operation status|resume|abandon` and `apn receipt get` take an operation of every
 * registered family through its index adapter. Each answer is the family's own: a result, the family's own refusal, or
 * (for a family whose recovery, receipt or exit is a separate command) a blocked answer that names that command.
 */
class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}
type Answer = "ok" | { readonly code: string; readonly reason?: string; readonly family?: true };
interface Case { readonly id: string; readonly root: string; readonly status: Answer; readonly resume: Answer; readonly abandon: Answer; readonly receipt: Answer }
const CORPUS = join("tests", "fixtures", "legacy-corpus");
const byFamily = (reason: string): Answer => ({ code: "APN_OPERATION_BLOCKED", reason, family: true });
const RESUME_BY_FAMILY = byFamily("operation_resume_by_family_command"), EXIT_BY_FAMILY = byFamily("operation_exit_by_family_command");
const NO_RECEIPT: Answer = { code: "APN_RECEIPT_NOT_FOUND", family: true };

async function root(t: TestContext): Promise<string> {
  const temporary = await temporaryState(); t.after(temporary.cleanup); await new StateStore(temporary.root).initialize(); return temporary.root;
}
/** A record a released version wrote: the awaiting-approval fixture pinned by the derived-receipt goldens. */
async function golden(t: TestContext, file: string, directory: string): Promise<{ root: string; id: string }> {
  const state = await root(t), cases = JSON.parse(await readFile(join("tests", "fixtures", "derived-receipts", `${file}.json`), "utf8")) as
    readonly { readonly operation: { readonly profileHash: string; readonly operationId: string }; readonly receipt: { readonly state: string } }[];
  const { operation } = cases.find(entry => entry.receipt.state === "awaiting_approval")!;
  const path = join(state, directory, operation.profileHash, `${operation.operationId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, `${canonicalJson(operation)}\n`, { mode: 0o600 });
  return { root: state, id: operation.operationId };
}
async function corpus(t: TestContext, name: string, directory: string): Promise<{ root: string; id: string }> {
  const state = await root(t); await installLegacyCase(join(CORPUS, name), state);
  const [file] = (await readdir(join(state, directory), { recursive: true })).filter(entry => /[a-f0-9]{64}\.json$/u.test(entry));
  return { root: state, id: file!.split("/").at(-1)!.slice(0, 64) };
}

const FIXTURES: Readonly<Record<string, (t: TestContext) => Promise<Case>>> = {
  direct_transfer: async t => {
    // The owner's Base USDC policy window is current, so the prepare runs on the current clock.
    const state = await root(t), clock = new TestClock(); clock.value = new Date();
    await ensureWallet(makeCore({ root: state, native: new CanonicalDirectTestNative(state), clock }));
    const id = await prepareTransfer(makeCore({ root: state, rpc: new TestRpc(), clock }));
    return { id, root: state, status: "ok", resume: { code: "APN_RPC_CONFIG" },
      abandon: { code: "APN_OPERATION_BLOCKED", reason: "local_direct_not_abandonable" }, receipt: "ok" };
  },
  x402_fetch: async t => {
    const state = await root(t), challenge = challengeObservation({ finalUrl: X402_URL,
      header: canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, resource: { ...X402_PAYMENT_REQUIRED.resource, url: X402_URL } }) });
    const rpc = new RecoveryRpc(); rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
    const core = makeCore({ root: state, native: new ExactX402Native(), rpc, http: new QueuedHttp([challenge]), clock: new TestClock() });
    assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
    const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000",
      idempotencyKey: "generic-commands-x402" });
    assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    return { id: (prepared.operation as { operationId: string }).operationId, root: state, status: "ok", resume: { code: "APN_OPERATION_BLOCKED" },
      abandon: { code: "APN_OPERATION_BLOCKED" }, receipt: { code: "APN_RECEIPT_NOT_FOUND" } };
  },
  // The rail exit first resolves the account's execution owner, which this bare core does not configure: the family says so.
  rail_transfer: async t => ({ ...await golden(t, "rail", "rail-operations"), status: "ok", resume: "ok", abandon: { code: "APN_PROVIDER_UNAVAILABLE" },
    receipt: "ok" }),
  bridge_route: async t => ({ ...await golden(t, "bridge", "bridge-operations"), status: "ok", resume: "ok", abandon: EXIT_BY_FAMILY, receipt: "ok" }),
  gasless_transfer: async t => ({ ...await golden(t, "gasless", "gasless-operations"), status: "ok", resume: "ok",
    abandon: { code: "APN_OPERATION_BLOCKED" }, receipt: "ok" }),
  metamask_gasless_transfer: async t => ({ ...await golden(t, "metamask-gasless", "metamask-gasless-operations"), status: "ok", resume: "ok",
    abandon: { code: "APN_OPERATION_BLOCKED" }, receipt: "ok" }),
  smart_account_gasless_transfer: async t => ({ ...await golden(t, "smart-account-gasless", "smart-account-gasless-operations"), status: "ok",
    resume: "ok", abandon: { code: "APN_OPERATION_BLOCKED" }, receipt: "ok" }),
  // Facilitator recovery needs its Avalanche runtime, which this bare core lacks: the family itself says so.
  facilitator_gasless_transfer: async t => ({ ...await golden(t, "facilitator-gasless", "facilitator-gasless-operations"), status: "ok",
    resume: { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE", reason: "facilitator_gasless_capability" }, abandon: { code: "APN_OPERATION_BLOCKED" }, receipt: "ok" }),
  circle_route: async t => ({ ...await corpus(t, "22-v0543-circle-v2-evm-funding-public-receipt", "circle-v2-evm"), status: "ok",
    resume: RESUME_BY_FAMILY, abandon: EXIT_BY_FAMILY, receipt: "ok" }),
  merchant_x402: async t => ({ ...await corpus(t, "41-v0543-merchant-x402", "merchant-x402"), status: "ok", resume: RESUME_BY_FAMILY,
    abandon: EXIT_BY_FAMILY, receipt: NO_RECEIPT }),
  permit2_production: async t => {
    const f = await journalFixture(t);
    return { id: f.record.operationId, root: f.root, status: "ok", resume: RESUME_BY_FAMILY, abandon: EXIT_BY_FAMILY, receipt: NO_RECEIPT };
  },
  relay_unsigned: async t => ({ ...await corpus(t, "55-v0543-relay-unsigned-operation", "relay-unsigned-operations"), status: "ok",
    resume: RESUME_BY_FAMILY, abandon: EXIT_BY_FAMILY, receipt: NO_RECEIPT }),
  sei_gaszip: async t => ({ ...await corpus(t, "02-v0538-sei-gaszip", "sei-gaszip"), status: "ok", resume: RESUME_BY_FAMILY,
    abandon: EXIT_BY_FAMILY, receipt: NO_RECEIPT }),
  mega_gaszip: async t => ({ ...await corpus(t, "33-v0543-mega-gaszip", "mega-gaszip"), status: "ok", resume: RESUME_BY_FAMILY,
    abandon: EXIT_BY_FAMILY, receipt: NO_RECEIPT }),
};

function check(result: OutputEnvelope, expected: Answer, id: string, label: string): void {
  if (expected === "ok") {
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
    const body = JSON.stringify(result.operation ?? result.receipt);
    assert.ok(body.includes(id), `${label} names its operation`);
    return;
  }
  assert.equal(result.ok, false, label);
  assert.equal(result.error?.code, expected.code, `${label}: ${JSON.stringify(result.error)}`);
  if (expected.reason !== undefined) assert.equal(result.error?.details?.reason, expected.reason, label);
  // Never the generic not-found or not-covered answers: every registered family reaches its own code.
  assert.notEqual(result.error?.details?.reason, "operation_kind_not_covered", label);
  if (expected.family === true) {
    assert.ok(result.next_actions.length > 0, `${label} names its family's command`);
    for (const action of result.next_actions) assert.ok(action.startsWith("apn ") && action.includes(`--operation ${id}`), `${label}: ${action}`);
  }
}

test("every registered family answers status, resume, abandon and receipt get through its own adapter", async (t) => {
  const registered = [...operationRegistry().keys()];
  // A family that joins the registry must bring its fixture here (phase 4b WP2 adds nine).
  assert.deepEqual([...registered].sort(), Object.keys(FIXTURES).sort());
  for (const family of registered) {
    await t.test(family, async (sub) => {
      const fixture = await FIXTURES[family as OperationFamily]!(sub), approval = new Approval();
      const core = new ApnCore({ state: new StateStore(fixture.root, { lockWaitMs: 1_000 }), clock: new TestClock(), ids: { next: () => UUID },
        operationAbandonApproval: approval });
      const run = async (command: "operation.status" | "operation.resume" | "operation.abandon" | "receipt.get") =>
        await core.execute({ command, operationId: fixture.id });
      check(await run("operation.status"), fixture.status, fixture.id, `${family} status`);
      check(await run("operation.resume"), fixture.resume, fixture.id, `${family} resume`);
      check(await run("operation.abandon"), fixture.abandon, fixture.id, `${family} abandon`);
      check(await run("receipt.get"), fixture.receipt, fixture.id, `${family} receipt`);
      assert.equal(approval.calls.length, 0, `${family}: an ineligible abandon never asks the owner`);
    });
  }
});

test("families without an adapter yet are named with their own command; abandon keeps their existing owner exits", async (t) => {
  const state = await root(t), operationId = "7".repeat(64);
  await mkdir(join(state, "stargate-v2-token"), { mode: 0o700 });
  await writeFile(join(state, "stargate-v2-token", `${operationId}.json`), "{}\n", { mode: 0o600 });
  const core = makeCore({ root: state, native: new TestNative() });
  for (const command of ["operation.status", "operation.resume", "receipt.get", "operation.abandon"] as const) {
    const result = await core.execute({ command, operationId });
    assert.equal(result.error?.code, "APN_UNSUPPORTED_COMMAND", JSON.stringify(result));
    assert.equal(result.error?.details?.reason, "operation_kind_not_covered");
    assert.equal(result.error?.details?.family, "stargate_token");
    assert.deepEqual(result.next_actions, [`apn stargate token status --operation ${operationId}`]);
  }
  const unknown = await core.execute({ command: "operation.status", operationId: "8".repeat(64) });
  assert.equal(unknown.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.deepEqual(unknown.error?.details?.covered_families, [...operationRegistry().keys()]);

  // A MetaMask native transfer still reaches its own owner exit (it decides eligibility and consent itself).
  const native = await root(t); await installLegacyCase(join(CORPUS, "43-v0543-metamask-native-driver-native-crosschain"), native);
  const [file] = await readdir(join(native, "metamask-native-operations")), nativeId = file!.slice(0, 64);
  const nativeCore = makeCore({ root: native });
  const status = await nativeCore.execute({ command: "operation.status", operationId: nativeId });
  assert.equal(status.error?.details?.family, "metamask_native");
  assert.deepEqual(status.next_actions, [`apn wallet metamask native-transfer-status --operation ${nativeId}`]);
  const abandon = await nativeCore.execute({ command: "operation.abandon", operationId: nativeId });
  assert.notEqual(abandon.error?.code, "APN_UNSUPPORTED_COMMAND", JSON.stringify(abandon));
});
