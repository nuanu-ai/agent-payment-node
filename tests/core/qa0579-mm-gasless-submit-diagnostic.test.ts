/**
 * QA 0.5.79 MM-GASLESS-SUBMIT-UNKNOWN-079-002: two fresh Base MetaMask gasless dispatches ended `unknown_finality /
 * mm_gasless_submit_unknown` and the exact GET answered 404, with nothing saying where the submit stopped. The submit
 * now reports closed facts of its own attempt (submit-diagnostic.ts) with that call's output; the outcome stays unknown.
 * These run the real vendored SDK against a synthetic provider.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HelperNetworkPolicy, networkContextRequest, type FetchExchangeRequest, type FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION, SubprocessMetaMaskGaslessHelperRunner,
  type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import { runnerDiagnostic, submitDiagnostic, submitErrorCode, submitFailureError, validateSubmitDiagnostic } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import type { MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { expectedQuote, intent, NOW, OWNER, PROJECT, SECRET, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";
import { mmFixture } from "./metamask-gasless-helpers.js";

/** The synthetic provider, with the relay POST answered as `answer` says. */
class Answer extends SdkExchange {
  constructor(chainId: number, private readonly answer: (posted: Record<string, unknown>) => FetchExchangeResponse) { super(chainId); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    if (request.method !== "POST" || !request.url.endsWith("/transaction-requests")) return await super.request(request);
    this.requests.push(request); request.beforeSend?.(); this.beforeSends += 1;
    return this.answer(JSON.parse(request.body!) as Record<string, unknown>);
  }
}
async function dispatchable(t: import("node:test").TestContext, chainId = 8453 as const) {
  const home = await syntheticHome(); t.after(home.cleanup);
  const quote = expectedQuote(chainId);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned", input: { owner: OWNER, chainId, executions: quote.executions } },
    { now: () => NOW, exchange: new SdkExchange(chainId) });
  assert.equal(built.ok, true); if (!built.ok) throw new Error("unsigned build failed");
  return { home, operation: intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult) };
}
const diagnostic = (stage: string, facts: Record<string, unknown>) => ({ mode: "submit", stage, post: "sent", httpStatus: null, check: "unclassified",
  providerError: null, providerStatus: null, ...facts });

test("the provider's answer to the one POST is reported as closed facts: status, error code, refused check, unknown job status", async (t) => {
  const { home, operation } = await dispatchable(t);
  const submit = async (answer: (posted: Record<string, unknown>) => FetchExchangeResponse) => {
    const exchange = new Answer(8453, answer);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation }, { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(exchange.requests.length, 1, "one POST only"); assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(result.ok, false); if (result.ok) throw new Error("unexpected success");
    assert.deepEqual(result.failure, { code: "APN_OPERATION_BLOCKED", reason: "mm_gasless_submit_unknown" });
    return result.submitDiagnostic;
  };
  const rejected = await submit(() => ({ status: 400, body: JSON.stringify({ error: { code: "INVALID_DELEGATION", message: "private text https://leak.example" } }) }));
  assert.deepEqual(rejected, diagnostic("post", { httpStatus: 400, check: "http_status", providerError: "INVALID_DELEGATION" }));
  assert.equal(JSON.stringify(rejected).includes("leak.example"), false, "provider text never crosses");
  const plain = await submit(() => ({ status: 503, body: "upstream unavailable" }));
  assert.deepEqual(plain, diagnostic("post", { httpStatus: 503, check: "http_status" }));
  const otherId = await submit(posted => ({ status: 201, body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000099", status: "EVALUATING", tx: posted.tx }) }));
  assert.deepEqual(otherId, diagnostic("response", { httpStatus: 201, check: "response_request_id" }));
  const queued = await submit(posted => ({ status: 200, body: JSON.stringify({ requestId: posted.requestId, status: "QUEUED", tx: posted.tx }) }));
  assert.deepEqual(queued, diagnostic("response", { httpStatus: 200, check: "response_status", providerStatus: "QUEUED" }));
  const odd = await submit(posted => ({ status: 200, body: JSON.stringify({ requestId: posted.requestId, status: "queued <b>", tx: posted.tx }) }));
  assert.deepEqual(odd, diagnostic("response", { httpStatus: 200, check: "response_status" }));
  const notJson = await submit(() => ({ status: 200, body: "<html>" }));
  assert.deepEqual(notJson, diagnostic("post", { httpStatus: 200, check: "response_body" }));
  // The POST left and no answer came back: it may have reached MetaMask.
  const lost = await submit(() => { throw new Error("socket hang up"); });
  assert.deepEqual(lost, diagnostic("post", { check: "no_answer" }));
});

test("APN's own refusals say whether the POST left: the body check refuses it unsent, the deadline before it, a session error after", async (t) => {
  const { home, operation } = await dispatchable(t);
  const exchange = new SdkExchange(8453);
  const policy = new HelperNetworkPolicy(networkContextRequest("submit", operation, PROJECT, home.token, () => NOW), exchange);
  policy.primeSubmitClock(NOW); policy.setExpectedSubmitBody({ requestId: operation.requestId, other: true });
  await assert.rejects(policy.fetch(`https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/transaction-requests`,
    { method: "POST", headers: { authorization: `Bearer ${home.token}`, "content-type": "application/json" }, body: JSON.stringify({ requestId: operation.requestId }) }));
  assert.deepEqual(policy.submitFacts(), { post: "refused", httpStatus: null, check: "body_mismatch", providerError: null });
  assert.equal(exchange.requests.length, 0, "nothing was sent");
  const denied = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange: new SdkExchange(8453, 401) });
  assert.equal(denied.ok, false); if (!denied.ok) {
    assert.equal(denied.failure.reason, "mm_gasless_session_unavailable");
    assert.deepEqual(denied.submitDiagnostic, diagnostic("post", { httpStatus: 401, check: "session" }));
  }
  let calls = 0;
  const late = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation }, { homeDirectory: home.home,
    now: () => ++calls < 5 ? NOW : new Date(operation.expiresAt), exchange: new SdkExchange(8453) });
  assert.equal(late.ok, false); if (!late.ok) {
    assert.equal(late.failure.reason, "mm_gasless_expired");
    assert.deepEqual(late.submitDiagnostic, diagnostic("post", { post: "not_reached", check: "deadline" }));
  }
});

test("only a refusal before the helper process starts says not_reached; after it ran the POST may have left", async (t) => {
  const { home, operation } = await dispatchable(t);
  // Pre-spawn: the runner refuses the request before any child exists.
  await assert.rejects(new SubprocessMetaMaskGaslessHelperRunner().run({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { environment: { HOME: home.home }, timeoutMs: 0 }),
  { details: { reason: "mm_gasless_submit_unknown", submitStage: "launch", submitPost: "not_reached", submitCheck: "runner_launch" } });
  for (const check of ["runner_exit", "runner_timeout", "runner_output"] as const) {
    assert.deepEqual(runnerDiagnostic(check, true), diagnostic("runner", { post: "unknown", check }));
  }
  assert.deepEqual(runnerDiagnostic("runner_launch", false), diagnostic("launch", { post: "not_reached", check: "runner_launch" }));
});

test("the parent carries the diagnostic, including a runner that failed, and never accepts a forged one", async (t) => {
  const { home, operation } = await dispatchable(t);
  const helper = (exchange: SdkExchange): MetaMaskGaslessHelperRunner => ({ async run(request) {
    return await executeHelperRequest(request, { homeDirectory: home.home, now: () => NOW, exchange }); } });
  const client = (runner: MetaMaskGaslessHelperRunner) => new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => NOW }, runner });
  await assert.rejects(client(helper(new Answer(8453, () => ({ status: 422, body: JSON.stringify({ code: "UNSUPPORTED_CHAIN" }) })))).submit(operation),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "mm_gasless_submit_unknown", submitStage: "post", submitPost: "sent", submitCheck: "http_status",
      submitHttpStatus: 422, submitProviderError: "UNSUPPORTED_CHAIN" } });
  // A runner that does not say whether its helper started may have let the POST out.
  await assert.rejects(client({ async run() { throw new Error("spawn failed"); } }).submit(operation),
    { details: { reason: "mm_gasless_submit_unknown", submitStage: "runner", submitPost: "unknown", submitCheck: "runner_launch" } });
  // A runner error is rebuilt as the submit's own unknown, whatever reason it carried.
  await assert.rejects(client({ async run() { throw submitFailureError("mm_gasless_clock", runnerDiagnostic("runner_timeout", true)); } }).submit(operation),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "mm_gasless_submit_unknown", submitStage: "runner", submitPost: "unknown", submitCheck: "runner_timeout" } });
  // A clock failure the helper reported keeps its reason, so execution still stops instead of recording an outcome.
  const clock = { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_REPREPARE_REQUIRED", reason: "mm_gasless_clock" },
    submitDiagnostic: diagnostic("post", { post: "not_reached", check: "clock" }) };
  await assert.rejects(client({ async run() { return clock; } }).submit(operation), { details: { reason: "mm_gasless_clock", submitCheck: "clock",
    submitPost: "not_reached", submitStage: "post" } });
  const forged = { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_OPERATION_BLOCKED", reason: "mm_gasless_submit_unknown" },
    submitDiagnostic: { ...diagnostic("post", { httpStatus: 400, check: "http_status" }), providerError: "lower case" } };
  await assert.rejects(client({ async run() { return forged; } }).submit(operation),
    { details: { reason: "mm_gasless_submit_unknown", submitStage: "helper_response", submitPost: "unknown", submitCheck: "response_invalid" } });
});

test("the closed diagnostic form refuses everything it does not define", () => {
  assert.deepEqual(validateSubmitDiagnostic(submitDiagnostic("post", { post: "sent", httpStatus: 400, check: "http_status", providerError: "BAD", providerStatus: null })),
    diagnostic("post", { httpStatus: 400, check: "http_status", providerError: "BAD" }));
  for (const bad of [{ post: "not_reached", httpStatus: 400 }, { providerError: "BAD", httpStatus: 200 }, { providerStatus: "QUEUED", check: "http_status" },
    { check: "invented" }, { stage: "invented" }, { extra: 1 }, { httpStatus: 99 }, { stage: "launch" }, { stage: "runner", post: "sent" }, { post: undefined }]) {
    assert.throws(() => validateSubmitDiagnostic({ ...diagnostic("post", { httpStatus: 400, check: "http_status" }), ...bad }), { details: { reason: "mm_gasless_submit_unknown" } });
  }
  assert.equal(submitErrorCode(JSON.stringify({ error: { code: "A_B" } })), "A_B");
  assert.equal(submitErrorCode(JSON.stringify({ errorCode: "X".repeat(41) })), null);
  assert.equal(submitErrorCode(JSON.stringify({ errorCode: "TRANSACTION_REQUEST_NOT_FOUND" })), "TRANSACTION_REQUEST_NOT_FOUND");
  assert.equal(submitErrorCode("not json"), null);
});

test("approve shows where its own submit stopped and keeps the outcome unknown; nothing of it is saved", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-submit-diag-"));
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.rpc.phase = "pending"; f.rpc.candidate = null;
    f.provider.submitError = submitFailureError("mm_gasless_submit_unknown", submitDiagnostic("post",
      { post: "sent", httpStatus: 400, check: "http_status", providerError: "INVALID_DELEGATION", providerStatus: null }));
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const shown = approved.operation as Record<string, unknown>;
    assert.deepEqual([shown.state, shown.reason], ["unknown_finality", "mm_gasless_submit_unknown"]);
    assert.deepEqual(shown.submit_diagnostic, { stage: "post", post: "sent", http_status: 400, check: "http_status", provider_error: "INVALID_DELEGATION",
      provider_status: null });
    assert.equal(JSON.stringify(await f.record(id)).includes("INVALID_DELEGATION"), false, "the journal keeps no diagnostic");
    const later = await f.restart().execute({ command: "operation.status", operationId: id });
    assert.equal("submit_diagnostic" in (later.operation as Record<string, unknown>), false);
    assert.equal(f.provider.submissions.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
