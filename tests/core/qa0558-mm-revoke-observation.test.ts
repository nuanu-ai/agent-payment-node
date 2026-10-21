import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskCliRevocationWallet } from "../../src/metamask-gasless/revocation/wallet.js";
import { METAMASK_AGENT_WALLET_SHASUM, METAMASK_AGENT_WALLET_VERSION } from "../../src/metamask-package.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskProcessFailureObservation, type MetaMaskCapturedLaunchPort } from "../../src/metamask-process-runner.js";
import { stargateNativeEnvelope } from "../../src/stargate-v2/native-runtime.js";
import type { Address, Hex } from "../../src/model.js";

const FROM = `0x${"1".repeat(40)}` as Address, HASH = `0x${"a".repeat(64)}`, RID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "provider said 0xdeadbeef and token sk-synthetic";
const PROVIDER = { package: "@metamask/agent-wallet", version: METAMASK_AGENT_WALLET_VERSION, shasum: METAMASK_AGENT_WALLET_SHASUM };
const SELECTED = JSON.stringify({ ok: true, data: { mode: "server", chainNamespace: "evm", address: FROM } });
const STDERR_ERROR = JSON.stringify({ _error: { code: "POLICY_VIOLATION", message: SECRET } });
const EMPTY = { bytes: 0, captured: "empty", sha256: null, frames: [], framesOmitted: 0 };
const ERROR_FRAME = { json: true, type: "object", object: { otherKeys: 0, keys: [{ key: "_error", type: "object",
  object: { otherKeys: 0, keys: [{ key: "code", type: "string", value: "POLICY_VIOLATION" }, { key: "message", type: "string" }] } }] } };

interface Answer { readonly stdout?: string; readonly stderr?: string; readonly code?: number; readonly hang?: boolean }
function launcher(send: Answer) {
  const inputs: Buffer[] = [];
  const launch: MetaMaskCapturedLaunchPort = (_executable, args) => {
    const answer: Answer = args[2] === "address" ? { stdout: SELECTED, code: 0 } : send;
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
    queueMicrotask(() => {
      for (const [stream, text] of [[child.stdout, answer.stdout], [child.stderr, answer.stderr]] as const) {
        if (text !== undefined) { const bytes = Buffer.from(text); inputs.push(bytes); stream.emit("data", bytes); }
      }
      if (answer.hang !== true) child.emit("close", answer.code ?? 0);
    });
    return child;
  };
  return { runner: new NodeMetaMaskProcessRunner(async () => "/test-only", launch, undefined, 20), zeroed: () => inputs.every((b) => b.every((x) => x === 0)) };
}
const send = async (answer: Answer) => {
  const fake = launcher(answer);
  const submitted = await new MetaMaskCliRevocationWallet(fake.runner).send({ chainId: 8453, from: FROM, payload: { data: "0x01" as Hex }, intent: "APN test" });
  assert.ok(fake.zeroed(), "child bytes are zeroed after the shape is taken");
  assert.ok(!JSON.stringify(submitted).includes("deadbeef") && !JSON.stringify(submitted).includes("sk-synthetic") && !JSON.stringify(submitted).includes(RID));
  return submitted as Record<string, any>;
};

test("an empty stdout with a stderr refusal is named empty and keeps exit, sizes, hashes and key shapes without values", async () => {
  const submitted = await send({ stderr: STDERR_ERROR, code: 1 });
  assert.equal(submitted.disposition, "unknown"); assert.equal(submitted.reason, "provider_response_empty");
  const { durationMs, ...provider } = submitted.provider; assert.ok(Number.isSafeInteger(durationMs));
  assert.deepEqual(provider, { provider: PROVIDER, outcome: "exit", exitCode: 1, signal: null, stdout: EMPTY,
    stderr: { bytes: Buffer.byteLength(STDERR_ERROR), captured: "complete", sha256: sha256(STDERR_ERROR), frames: [ERROR_FRAME], framesOmitted: 0 } });
});

test("a non-JSON stdout stays malformed and shows only its line sizes", async () => {
  const submitted = await send({ stdout: `${SECRET}\n${STDERR_ERROR}`, code: 0 });
  assert.equal(submitted.reason, "provider_response_malformed");
  assert.deepEqual(submitted.provider.stdout.frames, [{ json: false, bytes: Buffer.byteLength(SECRET) }, ERROR_FRAME]);
  assert.equal(submitted.provider.stderr.captured, "empty");
});

test("a timed-out send keeps the notice's shape and outcome, never its request id", async () => {
  const notice = JSON.stringify({ _notice: { kind: "AWAITING_MFA", pollingId: RID } });
  const submitted = await send({ stdout: notice, hang: true });
  assert.equal(submitted.reason, "provider_handoff_outcome_unknown");
  assert.equal(submitted.provider.outcome, "timeout"); assert.equal(submitted.provider.exitCode, null);
  assert.deepEqual(submitted.provider.stdout.frames, [{ json: true, type: "object", object: { otherKeys: 0, keys: [{ key: "_notice", type: "object",
    object: { otherKeys: 0, keys: [{ key: "kind", type: "string", value: "AWAITING_MFA" }, { key: "pollingId", type: "string" }] } }] } }]);
});

test("acknowledged and pending answers carry no provider shape", async () => {
  const acknowledged = await send({ stdout: JSON.stringify({ ok: true, data: { mode: "server", address: FROM, hash: HASH } }), code: 0 });
  assert.deepEqual(Object.keys(acknowledged).sort(), ["disposition", "requestIdHash", "transactionHash"]);
  const pending = await send({ stdout: JSON.stringify({ ok: true, data: { mode: "server", address: FROM, pollingId: RID, status: "AWAITING_MFA" } }), code: 0 });
  assert.deepEqual(Object.keys(pending).sort(), ["disposition", "requestIdHash"]);
});

test("a rejected run leaves one-use stream shapes; an oversize stdout is marked truncated with no hash", async () => {
  const fake = launcher({ stdout: "x".repeat(1024 * 1024 + 1), stderr: "y".repeat(5000), hang: true });
  let caught: unknown;
  try { await fake.runner.runJson(["wallet", "send-transaction"]); } catch (error) { caught = error; }
  assert.ok(caught instanceof ApnError);
  const observed = takeMetaMaskProcessFailureObservation(caught)!;
  assert.equal(observed.outcome, "protocol"); assert.deepEqual({ ...observed.stdout, frames: [] }, { bytes: 1024 * 1024 + 1, captured: "truncated", sha256: null, frames: [], framesOmitted: 0 });
  assert.equal(takeMetaMaskProcessFailureObservation(caught), undefined);
  assert.equal(takeMetaMaskProcessFailureObservation(new ApnError("APN_PROVIDER_UNAVAILABLE", "fake")), undefined);
});

test("keys outside the name pattern are counted, not shown, and enum values must look like enum values", async () => {
  const fake = launcher({ stdout: JSON.stringify({ ok: false, "has space": 1, status: "free text with spaces", nested: { deep: { deeper: 1 } } }), code: 1 });
  const result = await fake.runner.runJson(["wallet", "send-transaction"]);
  assert.deepEqual(result.observation!.stdout.frames, [{ json: true, type: "object", object: { otherKeys: 1, keys: [
    { key: "ok", type: "boolean", value: false }, { key: "status", type: "string" },
    { key: "nested", type: "object", object: { otherKeys: 0, keys: [{ key: "deep", type: "object" }] } }] } }]);
  result.stdout.fill(0);
});

test("the early Stargate balance refusal names the principal and the LayerZero fee", async () => {
  const principal = 10_000_000_000_000n, fee = 604_922_023_256_769n, balance = 128_295_795_269_517n;
  const answer = (method: string) => method === "eth_chainId" ? "0x1" : method === "eth_getBlockByNumber"
    ? { number: "0x10", hash: `0x${"ab".repeat(32)}`, baseFeePerGas: "0x1" } : method === "eth_getBalance" ? `0x${balance.toString(16)}` : assert.fail(method);
  const rpc = { call: async (method: string) => answer(method), batchCall: async (calls: readonly { method: string }[]) => calls.map((c) => answer(c.method)) };
  await assert.rejects(stargateNativeEnvelope(rpc as never, rpc.call, true, { chainId: 1, from: FROM, to: FROM, data: "0x", valueAtomic: (principal + fee).toString(),
    debit: { principalAtomic: principal.toString(), messagingFeeAtomic: fee.toString() } }), (error: unknown) => {
    assert.ok(error instanceof ApnError); const details = error.details as Record<string, unknown>;
    assert.equal(details.reason, "insufficient_native_balance"); assert.equal(details.required_wei, "614922023256769");
    assert.equal(details.principal_wei, principal.toString()); assert.equal(details.messaging_fee_wei, fee.toString());
    assert.equal(details.native_balance_wei, balance.toString()); assert.equal(details.gas_included, false); return true;
  });
});
