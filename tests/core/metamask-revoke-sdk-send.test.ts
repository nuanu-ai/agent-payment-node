/**
 * 0.5.108: the gasless revoke's `disableDelegation` no longer goes through `mm wallet send-transaction`, which named the
 * server request itself. APN names the request id, checks with an `mm` read that the selected wallet is the delegator,
 * and sends the very request mm built for 0.5.107's payload and intent through the sandboxed helper, from mm's session
 * in whichever project holds the server wallet. Every answer names the request by the hash of APN's id. The `mm` read is
 * a double; the helper and the vendored SDK run in process against a synthetic `~/.metamask` and exchange.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchange, FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { runnerDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import { MetaMaskSdkRevocationWallet, metaMaskRevocationStoppedBeforeNetwork } from "../../src/metamask-gasless/revocation/wallet.js";
import type { MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import { OWNER, PROJECT, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

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
/** `mm wallet address --chain-namespace evm --json`: the selected server wallet, the only `mm` child the revoke runs. */
function mm(address: string = OWNER): MetaMaskProcessRunnerPort & { readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return { calls, async runJson(argv: readonly string[]) {
    calls.push(argv); return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data: { mode: "server", chainNamespace: "evm", address } })) };
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
const send = (w: MetaMaskSdkRevocationWallet, payload: Record<string, string> = PAYLOAD) =>
  w.send({ chainId: 8453, from: OWNER, payload: payload as unknown as typeof PAYLOAD, intent: INTENT });
const hashOf = (requestId: string) => sha256(`apn.metamask-revocation.request-id.v1\0${requestId}`);

test("the disable is the request mm 6.1.5 sent for 0.5.107's payload, with APN's own id, in the session's own project", async (t) => {
  const server = new Server(), { home, vendor, wallet: w } = await wallet(t, server);
  const submitted = await send(w);
  assert.deepEqual(vendor.calls, [["wallet", "address", "--chain-namespace", "evm", "--json"]], "mm only reads the selected wallet");
  assert.equal(server.requests.length, 1);
  const [request] = server.requests, requestId = server.requestId();
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual([request!.url, request!.method, request!.headers.authorization], [COLLECTION, "POST", `Bearer ${home.token}`]);
  assert.equal(request!.body, JSON.stringify({ requestId, namespace: "evm", chainId: 8453, tx: { from: OWNER, to: MANAGER.toLowerCase(), chainId: 8453,
    data: DATA, value: "0x0", nonce: 0, gasLimit: "0xea60", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0xf4240" }, txIntent: INTENT }));
  assert.deepEqual(submitted, { disposition: "pending", requestIdHash: hashOf(requestId) });
  assert.equal(JSON.stringify(submitted).includes(requestId), false, "the request id stays private; its hash names it");
});

test("a selected wallet that is not the delegator, or a payload APN never writes, refuses before the helper starts", async (t) => {
  const server = new Server(), refused = await wallet(t, server, undefined, "0x2222222222222222222222222222222222222222");
  await assert.rejects(send(refused.wallet), (error: unknown) => error instanceof ApnError && error.code === "APN_PROFILE_DRIFT" &&
    error.details?.reason === "mm_revoke_wallet_mismatch");
  const malformed = await wallet(t, server);
  await assert.rejects(send(malformed.wallet, { ...PAYLOAD, value: "0x1" }), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
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
  assert.equal(metaMaskRevocationStoppedBeforeNetwork(stopped), true);
  const refusing = new Server({}, 422, JSON.stringify({ error: { code: "POLICY_VIOLATION" } })), sent = await wallet(t, refusing);
  const answered = await send(sent.wallet);
  assert.equal(answered.disposition, "unknown"); assert.equal(metaMaskRevocationStoppedBeforeNetwork(answered), false, "this one left the machine");
  const lost = await wallet(t, new Server(), submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_timeout", true)));
  assert.equal(metaMaskRevocationStoppedBeforeNetwork(await send(lost.wallet)), false, "a helper killed after its start may have sent");
});
