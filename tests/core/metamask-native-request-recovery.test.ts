import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getAddress } from "viem";
import { sha256 } from "../../src/canonical.js";
import type { MetaMaskRequestNotFound } from "../../src/metamask-process-output.js";
import type { MetaMaskNativeRequestBinding, MetaMaskNativeServerRequestAnswer } from "../../src/metamask-native-request-server-read.js";

// QA 0.5.106: after a new `mm login`, `mm wallet requests watch <id>` answers REQUEST_NOT_FOUND on stderr with an empty
// stdout, because mm 6.1.5 looks the id up in its local `pendingJobs` first. These doubles test the read contract only:
// the runner returns what the real runner reports for that answer, and the server read returns its validated answer.
const PROJECT = "11111111-2222-4333-8444-555555555555", PROJECT_HASH = sha256(PROJECT);
const RID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", TX = `0x${"a".repeat(64)}` as const, SERVER_HASH = "9".repeat(64);
const PAYER = getAddress("0x4444444444444444444444444444444444444444");
const BINDING: MetaMaskNativeRequestBinding = { sender: PAYER, chainId: 1 };
let queue: { exitCode: number; stdout: Buffer; requestNotFound?: MetaMaskRequestNotFound }[] = [];
let calls: (readonly string[])[] = [];
let serverCalls: unknown[][] = [];
let serverAnswer: MetaMaskNativeServerRequestAnswer = { outcome: "not_found" };
mock.module("../../src/metamask-package.js", { namedExports: { resolveMetaMaskBin: async () => "/test-only-pinned-package" } });
mock.module("../../src/metamask-process-runner.js", { namedExports: { takeMetaMaskNativeProcessFailureDiagnostic: () => undefined,
  takeMetaMaskNativeProcessFailureIdentifiers: () => undefined, NodeMetaMaskProcessRunner: class {
    async runJson(argv: readonly string[]) { calls.push(argv); const value = queue.shift(); assert.ok(value, "unexpected child call"); return value; }
  } } });
mock.module("../../src/metamask-native-transfer-owner.js", { namedExports: { claimMetaMaskNativeOwnedScope: () => { throw new Error("unowned"); },
  assertMetaMaskNativeOwnedScope: () => { throw new Error("unowned"); }, assertMetaMaskNativeOwnedContextCurrent: async () => { throw new Error("unowned"); } } });
mock.module("../../src/metamask-native-request-server-read.js", { namedExports: {
  readMetaMaskNativeServerRequest: async (...args: unknown[]) => { serverCalls.push(args); return serverAnswer; } } });
const { readMetaMaskNativeRequest } = await import("../../src/metamask-native-transfer-adapter.js");

function setup(answer: MetaMaskNativeServerRequestAnswer = { outcome: "not_found" }) { queue = []; calls = []; serverCalls = []; serverAnswer = answer; }
function result(data: unknown, exitCode = 0) { return { exitCode, stdout: Buffer.from(JSON.stringify({ ok: true, data })) }; }
function project(id = PROJECT) { queue.push(result({ authenticated: true, summary: { mode: "session", projectId: id } })); }
/** The watch the QA run saw: exit 1, nothing on stdout, mm's REQUEST_NOT_FOUND on stderr as the runner classifies it. */
function missed(requestNotFound: MetaMaskRequestNotFound | undefined, after = PROJECT) {
  project(); queue.push({ exitCode: 1, stdout: Buffer.alloc(0), ...(requestNotFound === undefined ? {} : { requestNotFound }) }); project(after);
}
const EMPTY = sha256(Buffer.alloc(0));
const base = { stage: "complete", guard_step: null, request_id: RID, watch_returned: true, before_guard_verified: true, after_guard_verified: true,
  error_code: null, diagnostic: null } as const;

test("a local-state miss without the transfer's binding is classified precisely and read no further", async () => {
  setup(); missed("local_state");
  assert.deepEqual(await readMetaMaskNativeRequest(RID, PROJECT_HASH), { disposition: "unknown", reason: "metamask_request_not_in_local_state", requestId: RID,
    readObservation: { ...base, request_identity_verified: false, provider_status: null, transaction_hash: null, chain_id: null, response_hash: EMPTY,
      reason: "metamask_request_not_in_local_state" } });
  assert.deepEqual(calls.map((argv) => argv[1]), ["status", "requests", "status"]); assert.equal(serverCalls.length, 0);
});

test("the server and unattributed misses, and an empty answer without one, never trigger a server read", async () => {
  for (const [kind, reason] of [["server", "metamask_request_not_found_on_server"], ["unattributed", "provider_request_not_found"],
    [undefined, "provider_response_malformed"]] as const) {
    setup({ outcome: "verified", status: "CONFIRMED", transactionHash: TX, responseHash: SERVER_HASH }); missed(kind);
    const v = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
    assert.equal(v.disposition, "unknown"); assert.equal(v.disposition === "unknown" && v.reason, reason);
    assert.equal(v.readObservation?.reason, reason); assert.equal(v.readObservation?.provider_status, null);
    assert.equal(Object.hasOwn(v.readObservation!, "server_read"), false); assert.equal(serverCalls.length, 0);
  }
});

/** The same request's record as `requests watch` would print it, for the equivalence below. */
function watched(status: Record<string, unknown>) {
  project(); queue.push(result({ request: { pollingId: RID, kind: "transaction", namespace: "evm", chainId: 1 }, status })); project();
}
/** A read without what only the server read adds: its own answer hash, and the evidence hash of an MFA task. */
const without = (value: unknown) => {
  const { readObservation, mfa, ...hint } = value as Record<string, unknown> & { readonly readObservation: Record<string, unknown>;
    readonly mfa?: Record<string, unknown> };
  const { response_hash: _hash, server_read: _server, ...rest } = readObservation;
  return { ...hint, ...(mfa === undefined ? {} : { mfa: { ...mfa, evidenceHash: null } }), readObservation: rest };
};

test("a verified server answer is recorded exactly as a watch answer of the same request would be", async () => {
  for (const [status, txHash] of [["CONFIRMED", TX], ["EXPIRED", null], ["DENIED", null], ["FAILED", null], ["FAILED", TX], ["AWAITING_MFA", null],
    ["SIGNING", null], ["BROADCASTED", null]] as const) {
    setup({ outcome: "verified", status, transactionHash: txHash, responseHash: SERVER_HASH }); missed("local_state");
    const server = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
    assert.deepEqual(serverCalls, [[RID, PROJECT_HASH, BINDING]]);
    assert.deepEqual(calls.map((argv) => argv[1]), ["status", "requests", "status"], "the project bracket still surrounds the read");
    assert.deepEqual(server.readObservation?.server_read, { outcome: "verified", response_hash: SERVER_HASH, reason: null, check: null });
    assert.ok(Object.isFrozen(server.readObservation) && Object.isFrozen(server.readObservation?.server_read));
    setup(); watched({ status, ...(txHash === null ? {} : { txHash }) });
    const watch = await readMetaMaskNativeRequest(RID, PROJECT_HASH);
    assert.deepEqual(without(server), without(watch), status);
    if (server.disposition === "pending" && server.mfa !== undefined)
      assert.deepEqual(server.mfa, { expiresAt: null, authMethod: null, evidenceHash: SERVER_HASH }, "the task's evidence is the server's answer");
  }
  setup({ outcome: "verified", status: "EXPIRED", transactionHash: null, responseHash: SERVER_HASH }); missed("local_state");
  const expired = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
  assert.deepEqual(expired, { disposition: "unknown", reason: "provider_request_outcome_unknown", requestId: RID, chainId: 1,
    readObservation: { ...base, request_identity_verified: true, provider_status: "EXPIRED", transaction_hash: null, chain_id: 1, response_hash: EMPTY,
      reason: "provider_request_outcome_unknown", server_read: { outcome: "verified", response_hash: SERVER_HASH, reason: null, check: null } } });
  setup({ outcome: "verified", status: "CONFIRMED", transactionHash: TX, responseHash: SERVER_HASH }); missed("local_state");
  const confirmed = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
  assert.equal(confirmed.disposition, "acknowledged"); assert.equal(confirmed.transactionHash, TX); assert.equal(confirmed.chainId, 1);
});

test("a server 404 stays unknown, and a refused server read keeps the local-state reason; neither is proof", async () => {
  setup({ outcome: "not_found" }); missed("local_state");
  const missing = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
  assert.deepEqual(missing, { disposition: "unknown", reason: "metamask_request_not_found_on_server", requestId: RID,
    readObservation: { ...base, request_identity_verified: false, provider_status: null, transaction_hash: null, chain_id: null, response_hash: EMPTY,
      reason: "metamask_request_not_found_on_server", server_read: { outcome: "not_found", response_hash: null, reason: null, check: null } } });
  for (const [reason, check] of [["metamask_session_project_changed", null], ["mm_gasless_session_expired", null],
    ["mm_gasless_provider_unavailable", "response_tx"], ["provider_request_binding_invalid", null]] as const) {
    setup({ outcome: "refused", reason, check }); missed("local_state");
    const refused = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
    assert.equal(refused.disposition, "unknown"); assert.equal(refused.disposition === "unknown" && refused.reason, "metamask_request_not_in_local_state");
    assert.equal(refused.readObservation?.request_identity_verified, false); assert.equal(refused.readObservation?.provider_status, null);
    assert.deepEqual(refused.readObservation?.server_read, { outcome: "refused", response_hash: null, reason, check });
    assert.equal(refused.readObservation?.after_guard_verified, true);
  }
});

test("a project that changed around the server read keeps nothing the read said", async () => {
  setup({ outcome: "verified", status: "CONFIRMED", transactionHash: TX, responseHash: SERVER_HASH }); missed("local_state", "different-project");
  const drift = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
  assert.equal(drift.disposition, "unknown"); assert.equal(drift.disposition === "unknown" && drift.reason, "provider_request_read_guard_changed_or_unavailable");
  assert.equal(drift.readObservation?.stage, "after_guard"); assert.equal(drift.readObservation?.after_guard_verified, false);
  assert.equal(drift.transactionHash, TX, "a validated hash is kept as an unknown outcome's hint, as after a watch");
  setup(); project("different-project");
  const before = await readMetaMaskNativeRequest(RID, PROJECT_HASH, BINDING);
  assert.equal(before.readObservation?.guard_step, "project_before"); assert.equal(calls.length, 1); assert.equal(serverCalls.length, 0);
});
