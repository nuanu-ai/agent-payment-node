import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MetaMaskDirectAdapter } from "../../src/metamask-direct-adapter.js";
import { metaMaskRequestNotFound, metaMaskWatchMissReason, type MetaMaskRequestNotFound } from "../../src/metamask-process-output.js";
import { NodeMetaMaskProcessRunner, type MetaMaskCapturedLaunchPort, type MetaMaskProcessResult,
  type MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import { MetaMaskX402Adapter } from "../../src/metamask-x402-adapter.js";
import type { Address } from "../../src/model.js";

// `mm wallet requests watch` 6.1.5, verbatim: WalletRequestsWatchCommand refuses an id its local `pendingJobs` lacks before
// it asks MetaMask; jobPolling refuses a server 404 with its own fixed hint. Both write the answer to stderr, stdout empty.
const RID = "8cc50f3c-0000-4000-8000-000000000001";
const LOCAL_HINT = "Run `mm wallet requests list` to see open requests, then copy a polling ID.";
const SERVER_HINT = "The request was not found on the server — it may have expired or already completed. Run `mm wallet requests list`, or re-run the command.";
const localMiss = (id = RID) => ({ ok: false, error: { code: "REQUEST_NOT_FOUND", message: `No pending wallet request found for polling id ${id}.`, hint: LOCAL_HINT } });
const serverMiss = () => ({ ok: false, error: { code: "REQUEST_NOT_FOUND", message: "Request not found", hint: SERVER_HINT } });
const WATCH = ["wallet", "requests", "watch", RID, "--wallet-timeout", "1", "--json"] as const;
const SENDER = "0x1111111111111111111111111111111111111111" as Address;

test("a REQUEST_NOT_FOUND answer names where mm missed the request, by 6.1.5's exact wording for this very id", () => {
  assert.equal(metaMaskRequestNotFound(localMiss(), RID), "local_state");
  assert.equal(metaMaskRequestNotFound({ _error: localMiss().error }, RID), "local_state", "after a notice the answer is `_error`");
  assert.equal(metaMaskRequestNotFound(serverMiss(), RID), "server");
  assert.equal(metaMaskRequestNotFound(localMiss("other-request"), RID), "unattributed", "a local miss of another id is not this one's");
  assert.equal(metaMaskRequestNotFound({ ok: false, error: { code: "REQUEST_NOT_FOUND" } }, RID), "unattributed");
  for (const other of [{ ok: false, error: { code: "JOB_TIMEOUT", hint: LOCAL_HINT } }, { ok: true, data: localMiss().error },
    { ok: false, error: localMiss().error, extra: true }, "REQUEST_NOT_FOUND", null, undefined]) assert.equal(metaMaskRequestNotFound(other, RID), undefined);
});

test("only an empty stdout with a runner-observed miss gets a miss reason; every other watch keeps its classification", () => {
  const empty = Buffer.alloc(0);
  const reasons: Record<MetaMaskRequestNotFound, string> = { local_state: "metamask_request_not_in_local_state",
    server: "metamask_request_not_found_on_server", unattributed: "provider_request_not_found" };
  for (const [kind, reason] of Object.entries(reasons)) {
    assert.equal(metaMaskWatchMissReason({ stdout: empty, requestNotFound: kind as MetaMaskRequestNotFound }), reason);
    assert.equal(metaMaskWatchMissReason({ stdout: Buffer.from(" \n"), requestNotFound: kind as MetaMaskRequestNotFound }), reason);
  }
  assert.equal(metaMaskWatchMissReason({ stdout: empty }), undefined);
  assert.equal(metaMaskWatchMissReason({ stdout: Buffer.from(JSON.stringify({ _notice: { kind: "AWAITING_MFA", pollingId: RID } })),
    requestNotFound: "local_state" }), undefined);
});

function runner(stderr: string, exit = 1) {
  const emitted: Buffer[] = [];
  const launch: MetaMaskCapturedLaunchPort = () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
    queueMicrotask(() => { const bytes = Buffer.from(stderr); emitted.push(bytes); child.stderr.emit("data", bytes); child.emit("close", exit); });
    return child;
  };
  return { process: new NodeMetaMaskProcessRunner(async () => "/test-only", launch, undefined, 5_000), emitted };
}

test("the runner reads a watch's stderr answer before zeroing it and reports only where mm missed the request", async () => {
  const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  for (const [stderr, expected] of [[pretty(localMiss()), "local_state"], [pretty(serverMiss()), "server"],
    [`[progress] Checking authentication...\n${pretty(localMiss())}`, "local_state"], [pretty(localMiss("other-request")), "unattributed"],
    [pretty({ ok: false, error: { code: "JOB_TIMEOUT", message: "timed out", hint: LOCAL_HINT } }), undefined], ["not json\n", undefined]] as const) {
    const r = runner(stderr);
    const result = await r.process.runJson(WATCH);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout.length, 0);
    assert.equal(result.requestNotFound, expected); assert.equal(Object.hasOwn(result, "requestNotFound"), expected !== undefined);
    assert.ok(r.emitted.every((bytes) => bytes.every((byte) => byte === 0)), "the child's stderr bytes are zeroed");
  }
  const other = await runner(pretty(localMiss())).process.runJson(["auth", "status", "--json"]);
  assert.equal(Object.hasOwn(other, "requestNotFound"), false, "no other command is read for a request miss");
  const oversize = await runner(`${"x".repeat(5_000)}\n${pretty(localMiss())}`).process.runJson(WATCH);
  assert.equal(Object.hasOwn(oversize, "requestNotFound"), false, "a truncated stderr is never classified");
});

test("a real child answering as mm 6.1.5 does after a new login is a local-state miss of this very request", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apn-mm-watch-miss-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "mm.cjs");
  // argv: [node, script, "wallet", "requests", "watch", <id>, ...]; the answer goes to stderr, indented, and stdout stays empty.
  await writeFile(script, "const id=process.argv[5];process.stderr.write(JSON.stringify({ok:false,error:{code:\"REQUEST_NOT_FOUND\"," +
    `message:"No pending wallet request found for polling id "+id+".",hint:${JSON.stringify(LOCAL_HINT)}}},null,2)+"\\n");process.exitCode=1;`, { mode: 0o600 });
  const runner = new NodeMetaMaskProcessRunner(async () => script);
  const result = await runner.runJson(WATCH);
  assert.equal(result.exitCode, 1); assert.equal(result.stdout.length, 0); assert.equal(result.requestNotFound, "local_state");
  const other = await runner.runJson(["wallet", "requests", "watch", "00000000-0000-4000-8000-000000000002", "--json"]);
  assert.equal(other.requestNotFound, "local_state", "the child names whichever id it was asked");
});

class WatchRunner implements MetaMaskProcessRunnerPort {
  readonly calls: string[][] = [];
  constructor(private readonly watch: MetaMaskProcessResult) {}
  async runJson(argv: readonly string[]): Promise<MetaMaskProcessResult> {
    this.calls.push([...argv]);
    if (argv[1] === "select") return success({ selected: SENDER });
    if (argv[1] === "address") return success({ mode: "server", chainNamespace: "evm", address: SENDER });
    if (argv[1] === "requests" && argv[2] === "watch") return { ...this.watch, stdout: Buffer.from(this.watch.stdout) };
    throw new Error(`unexpected MetaMask fixture command: ${argv.join(" ")}`);
  }
  async runForeground(): Promise<number> { return 0; }
}
function success(data: Record<string, unknown>): MetaMaskProcessResult {
  return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data })) };
}
const miss = (requestNotFound?: MetaMaskRequestNotFound): MetaMaskProcessResult =>
  ({ exitCode: 1, stdout: Buffer.alloc(0), ...(requestNotFound === undefined ? {} : { requestNotFound }) });

test("the direct and x402 watches record the miss, never an outcome and never a second watch", async () => {
  for (const [requestNotFound, reason] of [["local_state", "metamask_request_not_in_local_state"],
    ["server", "metamask_request_not_found_on_server"], ["unattributed", "provider_request_not_found"],
    [undefined, "provider_response_malformed"]] as const) {
    const direct = new WatchRunner(miss(requestNotFound));
    assert.deepEqual(await new MetaMaskDirectAdapter(direct).observe({ recoveryToken: RID, sender: SENDER, waitSeconds: 1 }),
      { disposition: "ambiguous", reason });
    const x402 = new WatchRunner(miss(requestNotFound));
    assert.deepEqual(await new MetaMaskX402Adapter(x402).observe({ recoveryToken: RID, sender: SENDER, waitSeconds: 1 }),
      { disposition: "ambiguous", reason });
    for (const calls of [direct.calls, x402.calls]) assert.equal(calls.filter((argv) => argv[2] === "watch").length, 1);
  }
});
