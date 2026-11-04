/**
 * Regression: two live MetaMask gasless dispatches (Sei, Monad on 0.5.86) were answered 201 and refused by APN's
 * `response_tx` check, then proved completed on chain; nothing said which part of the answer's `tx` differed. The
 * submit and the observation now report closed facts of that `tx` (client/job-tx.ts): its shape, whether `from` is the
 * bound wallet, the chain id's form and whether it names the request's chain. No address or number crosses.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION, type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import { jobTx, validateJobTx } from "../../src/metamask-gasless/client/job-tx.js";
import { observeDiagnostic, observeFailureError, validateObserveDiagnostic } from "../../src/metamask-gasless/client/observe-diagnostic.js";
import { submitDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import type { MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { expectedQuote, intent, NOW, OWNER, SECRET, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";
import { mmFixture } from "./metamask-gasless-helpers.js";

const RELAYER = "0x9999999999999999999999999999999999999999";
/** What a tx that passes APN's check classifies as: never a valid refusal fact set. */
const owner = { tx: "object", from: "owner", chainId: "number", chainIdMatches: true } as const;
const wrongChain = { ...owner, chainIdMatches: false } as const;

/** The synthetic provider, with the relay POST or the job status GET answered as `answer` says. */
class Answer extends SdkExchange {
  constructor(chainId: number, private readonly method: "POST" | "GET",
    private readonly answer: (requestId: string) => FetchExchangeResponse) { super(chainId); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const job = this.method === "POST" ? request.url.endsWith("/transaction-requests") : request.url.includes("/transaction-requests/");
    if (request.method !== this.method || !job) return await super.request(request);
    this.requests.push(request); request.beforeSend?.();
    return this.answer(this.method === "POST" ? (JSON.parse(request.body!) as { requestId: string }).requestId : request.url.split("/").at(-1)!);
  }
}
async function dispatchable(t: import("node:test").TestContext, chainId = 1329 as const) {
  const home = await syntheticHome(); t.after(home.cleanup);
  const quote = expectedQuote(chainId);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned", input: { owner: OWNER, chainId, executions: quote.executions } },
    { now: () => NOW, exchange: new SdkExchange(chainId) });
  assert.equal(built.ok, true); if (!built.ok) throw new Error("unsigned build failed");
  return { home, operation: intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult) };
}
const job = (requestId: string, tx: unknown, status = "AWAITING_MFA") =>
  ({ status: 201, body: JSON.stringify({ requestId, status, ...(tx === undefined ? {} : { tx }) }) });

test("the answer's tx is classified into closed facts and nothing else", () => {
  const bound = { binding: { address: OWNER }, request: { chainId: 1329 } } as never;
  const rows: Array<[unknown, Record<string, unknown>]> = [
    [{ from: OWNER, chainId: 1329 }, owner],
    [{ from: `0X${OWNER.slice(2)}`, chainId: 1329 }, owner],
    // `from` is `owner` exactly when APN's own comparison passes it, whatever its JSON type.
    [{ from: [OWNER], chainId: "1329" }, { ...owner, chainId: "decimal_string" }],
    [undefined, { tx: "absent", from: null, chainId: null, chainIdMatches: null }],
    [null, { tx: "null", from: null, chainId: null, chainIdMatches: null }],
    ["0xdead", { tx: "other", from: null, chainId: null, chainIdMatches: null }],
    [{ from: RELAYER, chainId: "1329" }, { tx: "object", from: "other_address", chainId: "decimal_string", chainIdMatches: true }],
    [{ from: OWNER, chainId: "0x531" }, { ...owner, chainId: "hex_string" }],
    [{ from: OWNER, chainId: "eip155:1329" }, { ...owner, chainId: "caip2_string" }],
    [{ from: OWNER, chainId: 143 }, { ...owner, chainIdMatches: false }],
    [{ from: "server wallet", chainId: "sei" }, { tx: "object", from: "other_string", chainId: "other_string", chainIdMatches: null }],
    [{ chainId: 1.5 }, { tx: "object", from: "absent", chainId: "other", chainIdMatches: null }],
    [{ from: 7 }, { tx: "object", from: "other", chainId: "absent", chainIdMatches: null }],
  ];
  for (const [tx, facts] of rows) {
    assert.deepEqual(jobTx(tx, bound), facts, JSON.stringify(tx));
    if (facts !== owner) assert.deepEqual(validateJobTx(facts, "mm_gasless_submit_unknown"), facts);
  }
  // A set that says the tx passed the check can only be forged.
  for (const bad of [owner, { ...owner, from: "0x1111111111111111111111111111111111111111" }, { ...wrongChain, chainIdMatches: null },
    { tx: "absent", from: "owner", chainId: null, chainIdMatches: null }, { ...owner, chainId: "other", chainIdMatches: true }, { ...wrongChain, extra: 1 }]) {
    assert.throws(() => validateJobTx(bad, "mm_gasless_submit_unknown"), { details: { reason: "mm_gasless_submit_unknown" } });
  }
});

test("a 201 whose tx APN refuses reports how it differed, with the job status, and the parent carries it", async (t) => {
  const { home, operation } = await dispatchable(t);
  const submit = async (tx: unknown, status?: string) => {
    const exchange = new Answer(1329, "POST", requestId => job(requestId, tx, status));
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation }, { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(JSON.stringify(result).includes(SECRET), false); assert.equal(JSON.stringify(result).includes(RELAYER.slice(2)), false);
    assert.equal(result.ok, false); if (result.ok) throw new Error("unexpected success");
    assert.deepEqual(result.failure, { code: "APN_OPERATION_BLOCKED", reason: "mm_gasless_submit_unknown" });
    return result.submitDiagnostic;
  };
  const base = { mode: "submit", stage: "response", post: "sent", httpStatus: 201, check: "response_tx", providerError: null };
  assert.deepEqual(await submit(undefined), { ...base, providerStatus: "AWAITING_MFA", responseTx: { tx: "absent", from: null, chainId: null, chainIdMatches: null } });
  assert.deepEqual(await submit({ from: RELAYER, chainId: 1329 }, "EVALUATING"),
    { ...base, providerStatus: "EVALUATING", responseTx: { tx: "object", from: "other_address", chainId: "number", chainIdMatches: true } });
  assert.deepEqual(await submit({ from: OWNER, chainId: "eip155:1329" }, "queued <b>"),
    { ...base, providerStatus: null, responseTx: { ...owner, chainId: "caip2_string" } });
  // The facts cross the helper boundary as flat details and come back the same; a forged set is refused.
  const helper = (exchange: SdkExchange): MetaMaskGaslessHelperRunner => ({ async run(request) {
    return await executeHelperRequest(request, { homeDirectory: home.home, now: () => NOW, exchange }); } });
  const client = (runner: MetaMaskGaslessHelperRunner) => new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => NOW }, runner });
  await assert.rejects(client(helper(new Answer(1329, "POST", requestId => job(requestId, { from: OWNER, chainId: "1329" })))).submit(operation),
    { details: { reason: "mm_gasless_submit_unknown", submitStage: "response", submitPost: "sent", submitHttpStatus: 201,
      submitCheck: "response_tx", submitProviderStatus: "AWAITING_MFA", submitTx: "object",
      submitTxFrom: "owner", submitTxChainId: "decimal_string", submitTxChainIdMatches: true } });
  const forged = { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_OPERATION_BLOCKED", reason: "mm_gasless_submit_unknown" },
    submitDiagnostic: { ...base, providerStatus: null, responseTx: { ...owner, from: OWNER } } };
  for (const submitDiagnostic of [forged.submitDiagnostic, { ...base, providerStatus: null, responseTx: owner },
    { ...base, stage: "post", providerStatus: null, responseTx: wrongChain }, { ...base, httpStatus: 400, providerStatus: null, responseTx: wrongChain }]) {
    await assert.rejects(client({ async run() { return { ...forged, submitDiagnostic }; } }).submit(operation),
      { details: { reason: "mm_gasless_submit_unknown", submitStage: "helper_response", submitPost: "unknown", submitCheck: "response_invalid" } });
  }
  assert.throws(() => submitDiagnostic("response", { post: "sent", httpStatus: 201, check: "http_status", providerError: null, providerStatus: null,
    responseTx: wrongChain }), { details: { reason: "mm_gasless_submit_unknown" } }, "tx facts belong to the response_tx check only");
});

test("an observation whose job answer APN refuses says which check refused it; an accepted one carries none", async (t) => {
  const { home, operation } = await dispatchable(t);
  const observe = async (answer: (requestId: string) => FetchExchangeResponse) =>
    await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "observe", intent: operation },
      { homeDirectory: home.home, now: () => NOW, exchange: new Answer(1329, "GET", answer) });
  const missing = await observe(requestId => ({ status: 200, body: JSON.stringify({ requestId, status: "CONFIRMED", txHash: `0x${"44".repeat(32)}` }) }));
  assert.equal(missing.ok, false); if (missing.ok) throw new Error("unexpected success");
  assert.deepEqual(missing.failure, { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" });
  assert.deepEqual(missing.observeDiagnostic, { mode: "observe", check: "response_tx", providerStatus: "CONFIRMED",
    responseTx: { tx: "absent", from: null, chainId: null, chainIdMatches: null } });
  const unknown = await observe(requestId => ({ status: 200, body: JSON.stringify({ requestId, status: "QUEUED", tx: { from: OWNER, chainId: 1329 } }) }));
  assert.equal(unknown.ok, false); if (unknown.ok) throw new Error("unexpected success");
  assert.deepEqual(unknown.observeDiagnostic, { mode: "observe", check: "response_status", providerStatus: "QUEUED", responseTx: null });
  const accepted = await observe(requestId => ({ status: 200, body: JSON.stringify({ requestId, status: "CONFIRMED", tx: { from: OWNER, chainId: 1329 } }) }));
  assert.equal(accepted.ok, true);
  const failedRead = await observe(() => ({ status: 503, body: "{}" }));
  assert.equal(failedRead.ok, false); if (!failedRead.ok) assert.equal("observeDiagnostic" in failedRead, false, "no answer check ran");
  for (const bad of [{ check: "http_status" }, { providerStatus: "QUEUED", check: "response_kind" }, { responseTx: null }, { responseTx: owner }, { extra: 1 }]) {
    assert.throws(() => validateObserveDiagnostic({ ...observeDiagnostic("response_tx", null, wrongChain), ...bad }),
      { details: { reason: "mm_gasless_provider_unavailable" } });
  }
});

test("resume shows its own provider read: the accepted status, or the reason and the refused check; nothing of it is saved", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-job-tx-"));
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.rpc.phase = "pending"; f.rpc.candidate = null;
    f.provider.submitError = submitFailureError("mm_gasless_submit_unknown", submitDiagnostic("response", { post: "sent", httpStatus: 201,
      check: "response_tx", providerError: null, providerStatus: "AWAITING_MFA", responseTx: { tx: "absent", from: null, chainId: null, chainIdMatches: null } }));
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const shown = approved.operation as Record<string, unknown>;
    assert.deepEqual(shown.submit_diagnostic, { stage: "response", post: "sent", http_status: 201, check: "response_tx", provider_error: null,
      provider_status: "AWAITING_MFA", response_tx: { tx: "absent", from: null, chain_id: null, chain_id_matches: null } });
    assert.equal("provider_job_read" in shown, false, "approve reads no job status of its own");
    f.provider.observeError = observeFailureError("mm_gasless_provider_unavailable", observeDiagnostic("response_tx", "CONFIRMED",
      { tx: "object", from: "other_address", chainId: "number", chainIdMatches: true }));
    const refused = (await f.core.execute({ command: "operation.resume", operationId: id })).operation as Record<string, unknown>;
    assert.deepEqual(refused.provider_job_read, { ok: false, reason: "mm_gasless_provider_unavailable", check: "response_tx", provider_status: "CONFIRMED",
      response_tx: { tx: "object", from: "other_address", chain_id: "number", chain_id_matches: true } });
    f.provider.observeError = undefined; f.provider.status = "awaiting_approval"; f.provider.txHash = null;
    const read = (await f.core.execute({ command: "operation.resume", operationId: id })).operation as Record<string, unknown>;
    assert.deepEqual(read.provider_job_read, { ok: true, status: "awaiting_approval", tx_hash: false });
    const saved = JSON.stringify(await f.record(id));
    assert.equal(saved.includes("other_address") || saved.includes("provider_job_read"), false, "the journal keeps no diagnostic");
    assert.equal(f.provider.submissions.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
