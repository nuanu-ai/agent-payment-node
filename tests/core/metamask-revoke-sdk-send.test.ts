/**
 * 0.5.108: the gasless revoke's `disableDelegation` no longer goes through `mm wallet send-transaction`, which named the
 * server request itself. APN names the request id, checks with an `mm` read that the selected wallet is the delegator,
 * and sends the very request mm built for 0.5.107's payload and intent through the sandboxed helper, from mm's session
 * in whichever project holds the server wallet. Every answer names the request by the hash of APN's id. 0.5.109: the
 * check and the send are two steps (the revoke seals the id between them), the hash is the provider request reference
 * hash the seal is filed under, and the wallet reads a sealed request again for resume. The `mm` reads are a double; the
 * helper and the vendored SDK run in process against a synthetic `~/.metamask` and exchange.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchange, FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { runnerDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import { metaMaskRevocationRequestIdHash } from "../../src/metamask-gasless/revocation/requests.js";
import { MetaMaskSdkRevocationWallet, metaMaskRevocationUnsentCause, type MetaMaskRevocationSendInput } from "../../src/metamask-gasless/revocation/wallet.js";
import type { MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import { providerRequestReferenceHash } from "../../src/provider-request-reference-store.js";
import { OWNER, PROJECT, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

const MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3", DATA = `0x3ed01015${"00".repeat(64)}`, TX = `0x${"cd".repeat(32)}`;
const INTENT = `APN ${"a".repeat(64)}: disable delegation 0x${"ef".repeat(32)}`;
const PAYLOAD = { to: MANAGER, data: DATA, value: "0x0", gas: "0xea60", nonce: "0x0", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0xf4240" };
const COLLECTION = `https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/transaction-requests`;
const PRIVATE = "private_provider_metadata_canary";

class Server implements FetchExchange {
  readonly requests: FetchExchangeRequest[] = [];
  constructor(readonly patch: Record<string, unknown> = {}, readonly status = 200, readonly errorBody = "{}") {}
  async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    this.requests.push(request); request.beforeSend?.();
    if (this.status !== 200) return { status: this.status, body: this.errorBody };
    const posted = JSON.parse(request.body!) as { requestId: string; tx: unknown };
    return { status: 200, body: JSON.stringify({ requestId: posted.requestId, status: "EVALUATING", tx: posted.tx, txApprovalLink: PRIVATE, ...this.patch }) };
  }
  /** The request id APN named, as the one POST carried it. */
  requestId(): string { return (JSON.parse(this.requests[0]!.body!) as { requestId: string }).requestId; }
}
const SESSION = { authenticated: true, summary: { mode: "session", projectId: PROJECT } };
/**
 * `mm wallet address --chain-namespace evm --json`, the selected server wallet and the only `mm` child the revoke runs,
 * and `mm auth status --json`, the session's project, the only one resume runs. A thrown `auth` answer is a failed read.
 */
function mm(address: string = OWNER, auth: unknown = SESSION): MetaMaskProcessRunnerPort & { readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return { calls, async runJson(argv: readonly string[]) {
    calls.push(argv);
    if (argv[0] === "auth" && auth instanceof Error) throw auth;
    const data = argv[0] === "auth" ? auth : { mode: "server", chainNamespace: "evm", address };
    return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data })) };
  }, async runForeground() { throw new Error("TEST no foreground mm"); } };
}
async function wallet(t: test.TestContext, server: Server, failure?: unknown, selected?: string,
  session: Parameters<typeof syntheticHome>[0] = {}) {
  const home = await syntheticHome(session); t.after(home.cleanup);
  let runs = 0;
  const runner: MetaMaskGaslessHelperRunner = { async run(request, options) {
    runs += 1; assert.equal(request.mode, "submitTransaction"); assert.equal(options.timeoutMs, 120_000);
    // The helper lets the POST leave only within its own kill bound.
    const deadline = request.mode === "submitTransaction" ? Date.parse(request.transaction.expiresAt) - Date.now() : 0;
    assert.ok(deadline > 0 && deadline <= 120_000, "the send's deadline is its kill bound");
    if (failure !== undefined) throw failure;
    return await executeHelperRequest(request, { homeDirectory: home.home, exchange: server });
  } };
  const vendor = mm(selected);
  return { home, vendor, runs: () => runs, wallet: new MetaMaskSdkRevocationWallet(vendor,
    new MetaMaskGaslessProviderClient({ environment: {}, clock: { now: () => new Date() }, runner })) };
}
const input = (payload: Record<string, string> = PAYLOAD, requestId: string = randomUUID()): MetaMaskRevocationSendInput =>
  ({ requestId, chainId: 8453, from: OWNER, payload: payload as unknown as typeof PAYLOAD, intent: INTENT });
/** The revoke's two steps around its seal: the check, then the send of the same request. */
async function send(w: MetaMaskSdkRevocationWallet, payload: Record<string, string> = PAYLOAD) {
  const request = input(payload); await w.check(request); return await w.send(request);
}
/** 0.5.109: the provider request reference hash, written out independently; the id's seal is filed under it. */
const hashOf = (requestId: string) => sha256(`provider-effect-reference\0metamask-agent-wallet\0${requestId}`);

test("the hash that names a disable request is the provider request reference hash of its id", () => {
  const requestId = randomUUID();
  assert.equal(metaMaskRevocationRequestIdHash(requestId), hashOf(requestId));
  assert.equal(metaMaskRevocationRequestIdHash(requestId), providerRequestReferenceHash("metamask-agent-wallet", requestId));
  // The 0.5.105 to 0.5.108 formula is gone: those ids were never kept, so their hashes name nothing APN can read.
  assert.notEqual(metaMaskRevocationRequestIdHash(requestId), sha256(`apn.metamask-revocation.request-id.v1\0${requestId}`));
});

test("the disable is the request mm 6.1.5 sent for 0.5.107's payload, with APN's own id, in the session's own project", async (t) => {
  const server = new Server(), { home, vendor, wallet: w } = await wallet(t, server);
  const named = input();
  await w.check(named);
  assert.deepEqual(vendor.calls, [["wallet", "address", "--chain-namespace", "evm", "--json"]], "the check only reads the selected wallet");
  assert.equal(server.requests.length, 0, "the check sends nothing");
  const submitted = await w.send(named);
  assert.equal(vendor.calls.length, 1, "the send runs no mm child");
  assert.equal(server.requests.length, 1);
  const [request] = server.requests, requestId = server.requestId();
  assert.equal(requestId, named.requestId, "the request carries the id APN named (and the revoke sealed) before the send");
  assert.deepEqual([request!.url, request!.method, request!.headers.authorization], [COLLECTION, "POST", `Bearer ${home.token}`]);
  assert.equal(request!.body, JSON.stringify({ requestId, namespace: "evm", chainId: 8453, tx: { from: OWNER, to: MANAGER.toLowerCase(), chainId: 8453,
    data: DATA, value: "0x0", nonce: 0, gasLimit: "0xea60", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0xf4240" }, txIntent: INTENT }));
  assert.deepEqual(submitted, { disposition: "pending", requestIdHash: hashOf(requestId) });
  assert.equal(JSON.stringify(submitted).includes(requestId), false, "the request id stays private; its hash names it");
});

test("a selected wallet that is not the delegator, or a payload APN never writes, refuses at the check, before the helper starts", async (t) => {
  const server = new Server(), refused = await wallet(t, server, undefined, "0x2222222222222222222222222222222222222222");
  await assert.rejects(refused.wallet.check(input()), (error: unknown) => error instanceof ApnError && error.code === "APN_PROFILE_DRIFT" &&
    error.details?.reason === "mm_revoke_wallet_mismatch");
  const malformed = await wallet(t, server);
  await assert.rejects(malformed.wallet.check(input({ ...PAYLOAD, value: "0x1" })), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
  assert.equal(refused.runs() + malformed.runs(), 0); assert.equal(server.requests.length, 0);
});

test("every answer names the request by its hash: acknowledged with a live hash, unknown for a closed request or a failure", async (t) => {
  for (const [patch, expected] of [
    [{ status: "BROADCASTED", txHash: TX }, { disposition: "acknowledged", transactionHash: TX }],
    [{ status: "FAILED", txHash: TX }, { disposition: "unknown", reason: "provider_request_closed", providerStatus: "FAILED", transactionHash: TX }],
    [{ status: "DENIED" }, { disposition: "unknown", reason: "provider_request_closed", providerStatus: "DENIED" }],
    [{ status: "BROADCAST_TRACKING_EXPIRED" }, { disposition: "unknown", reason: "provider_request_outcome_unknown", providerStatus: "BROADCAST_TRACKING_EXPIRED" }],
    [{ status: "AWAITING_MFA" }, { disposition: "pending" }],
  ] as const) {
    const server = new Server(patch), { wallet: w } = await wallet(t, server);
    assert.deepEqual(await send(w), { ...expected, requestIdHash: hashOf(server.requestId()) }, JSON.stringify(patch));
  }
  // MetaMask's own error code of a refusing answer, and the send's closed facts.
  const refusing = new Server({}, 422, JSON.stringify({ error: { code: "POLICY_VIOLATION", message: PRIVATE } })), { wallet: w } = await wallet(t, refusing);
  const policy = await send(w);
  assert.deepEqual(policy, { disposition: "unknown", reason: "provider_handoff_outcome_unknown", requestIdHash: hashOf(refusing.requestId()),
    providerErrorCode: "POLICY_VIOLATION", submitDiagnostic: { mode: "submit", stage: "post", post: "sent", httpStatus: 422, check: "http_status",
      providerError: "POLICY_VIOLATION", providerStatus: null, responseTx: null }, helperFailure: "mm_gasless_submit_unknown" });
  assert.equal(JSON.stringify(policy).includes(PRIVATE), false);
  // A helper killed after it started: the request may have left, and is still named.
  const quiet = new Server(), lost = await wallet(t, quiet, submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_timeout", true)));
  const timedOut = await send(lost.wallet);
  assert.equal(timedOut.disposition, "unknown"); assert.match(timedOut.requestIdHash, /^[0-9a-f]{64}$/u);
  assert.equal(timedOut.disposition === "unknown" && timedOut.submitDiagnostic?.check, "runner_timeout"); assert.equal(quiet.requests.length, 0);
});

test("a helper that stopped before any network call stays unknown, names its reason, and is told apart from one that sent", async (t) => {
  const other = "0x2222222222222222222222222222222222222222", server = new Server();
  // mm's read says the delegator is selected, but the session the helper reads has another server wallet selected.
  const moved = await wallet(t, server, undefined, undefined, { ref: { address: other },
    remoteWallets: [{ address: OWNER, namespace: "evm" }, { address: other, namespace: "evm" }] });
  const stopped = await send(moved.wallet);
  assert.equal(server.requests.length, 0); assert.equal(stopped.disposition, "unknown");
  assert.deepEqual(stopped.disposition === "unknown" && [stopped.helperFailure, stopped.submitDiagnostic?.post, stopped.submitDiagnostic?.stage],
    ["mm_gasless_binding_changed", "not_reached", "private_state"]);
  assert.equal(metaMaskRevocationUnsentCause(stopped), "session_binding");
  const refusing = new Server({}, 422, JSON.stringify({ error: { code: "POLICY_VIOLATION" } })), sent = await wallet(t, refusing);
  const answered = await send(sent.wallet);
  assert.equal(answered.disposition, "unknown"); assert.equal(metaMaskRevocationUnsentCause(answered), undefined, "this one left the machine");
  const lost = await wallet(t, new Server(), submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_timeout", true)));
  assert.equal(metaMaskRevocationUnsentCause(await send(lost.wallet)), undefined, "a helper killed after its start may have sent");
});

test("resume reads a sealed request again: the session's project from mm auth status, then the request by its id through the helper", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = new SdkExchange(8453), modes: string[] = [];
  const runner: MetaMaskGaslessHelperRunner = { async run(request) {
    modes.push(request.mode); return await executeHelperRequest(request, { homeDirectory: home.home, exchange });
  } };
  const vendor = mm(), reader = new MetaMaskSdkRevocationWallet(vendor, new MetaMaskGaslessProviderClient({ environment: {}, clock: { now: () => new Date() }, runner }));
  const project = await reader.sessionProject();
  assert.deepEqual(project, { projectHash: sha256(PROJECT) }); assert.deepEqual(vendor.calls, [["auth", "status", "--json"]]);
  const requestId = randomUUID(), binding = { sender: OWNER, chainId: 8453 } as const;
  const answer = await reader.read(requestId, sha256(PROJECT), binding);
  assert.equal(answer.outcome, "verified");
  assert.deepEqual(answer.outcome === "verified" && [answer.status, answer.transactionHash], ["CONFIRMED", `0x${"44".repeat(32)}`]);
  assert.deepEqual(modes, ["readRequest"]); assert.equal(exchange.requests.length, 1);
  assert.deepEqual([exchange.requests[0]!.method, exchange.requests[0]!.url], ["GET", `${COLLECTION}/${requestId}`]);
  // Another project than the session's refuses in the helper before anything is read.
  const other = await reader.read(randomUUID(), sha256("another-project"), binding);
  assert.deepEqual(other, { outcome: "refused", reason: "metamask_session_project_changed", check: null }); assert.equal(exchange.requests.length, 1);
});

test("a session with no project, or an mm read that fails, gives the closed reason and reads nothing", async () => {
  const client = new MetaMaskGaslessProviderClient({ environment: {}, clock: { now: () => new Date() },
    runner: { async run() { throw new Error("TEST no helper read without a session project"); } } });
  for (const [auth, reason] of [
    [{ authenticated: false }, "metamask_session_required"],
    [{ authenticated: true, summary: { mode: "api-key", projectId: PROJECT } }, "metamask_session_required"],
    [{ authenticated: true, summary: { mode: "session", projectId: "not a project id" } }, "metamask_session_required"],
    [new ApnError("APN_PROVIDER_UNAVAILABLE", "synthetic mm failure"), "metamask_session_read_failed"],
  ] as const) {
    assert.deepEqual(await new MetaMaskSdkRevocationWallet(mm(OWNER, auth), client).sessionProject(), { reason }, JSON.stringify(auth));
  }
});
