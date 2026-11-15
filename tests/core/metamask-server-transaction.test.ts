/**
 * 0.5.108: a MetaMask server-wallet transaction request whose id APN names itself (the native transfer and the gasless
 * revoke), sent by the sandboxed helper the gasless lane uses. The tx is the one `mm wallet send-transaction` (pinned
 * 6.1.5) built from the `--payload` APN handed it up to 0.5.107; the helper's network policy admits exactly that one POST
 * and nothing else. The real vendored SDK runs in process against a synthetic `~/.metamask` and a synthetic exchange; no
 * HOME, Keychain or network.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type { ClientRequest } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION, type MetaMaskGaslessHelperRunner } from
  "../../src/metamask-gasless/client/index.js";
import { HelperNetworkPolicy, networkContextServerTransaction, type FetchExchange, type FetchExchangeRequest,
  type FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { endRequestWhenSecure } from "../../src/metamask-gasless/client/https-exchange.js";
import { helperRequest } from "../../src/metamask-gasless/client/protocol.js";
import { serverTransactionBody, type MetaMaskServerTransactionInput } from "../../src/metamask-gasless/client/server-transaction.js";
import { runnerDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import { metaMaskCliPayloadTx, metaMaskServerTransaction, sendMetaMaskServerTransaction } from "../../src/metamask-server-transaction.js";
import { OWNER, PROJECT, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

const RID = "5d1f6a2e-3b4c-4d5e-8f60-718293a4b5c6", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DATA = "0xa9059cbb000000000000000000000000555555555555555555555555555555555555555500000000000000000000000000000000000000000000000000000000000009c4";
const INTENT = `APN ${"6".repeat(64)}: 2500 atomic USDC to 0x5555555555555555555555555555555555555555`;
const COLLECTION = `https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/transaction-requests`;
const PRIVATE = "private_provider_metadata_canary", EXPIRES = "2030-01-01T00:10:00.000Z";
/** 0.5.107's `--payload` for the native transfer: every field a `0x` hex string, `to` checksummed. */
const PAYLOAD = { to: USDC, data: DATA, value: "0x0", gas: "0xfde8", nonce: "0x7", maxFeePerGas: "0xc8", maxPriorityFeePerGas: "0x2" };
/** The send's own deadline, well ahead of the real clock the helper runs on here. */
const DEADLINE = new Date(Date.now() + 3_600_000).toISOString();
const input = (patch: Partial<MetaMaskServerTransactionInput> = {}): MetaMaskServerTransactionInput =>
  ({ ...metaMaskServerTransaction({ requestId: RID, projectHash: sha256(PROJECT), from: OWNER, chainId: 1, payload: PAYLOAD, intent: INTENT,
    expiresAt: DEADLINE }), ...patch });
const submit = (transaction: unknown) => ({ version: MM_HELPER_VERSION, mode: "submitTransaction", transaction });

/** The server's answer to the one POST: the job MetaMask created for the posted request, with `patch` merged in. */
class TransactionExchange implements FetchExchange {
  readonly requests: FetchExchangeRequest[] = [];
  readonly bodies: string[] = [];
  beforeSends = 0;
  constructor(readonly patch: Record<string, unknown> = {}, readonly status = 200, readonly errorBody = "{}") {}
  async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    this.requests.push(request); request.beforeSend?.(); if (request.beforeSend) this.beforeSends += 1;
    if (this.status !== 200) return { status: this.status, body: this.errorBody };
    const posted = JSON.parse(request.body!) as { requestId: string; tx: unknown };
    const body = JSON.stringify({ requestId: posted.requestId, status: "EVALUATING", tx: posted.tx, txIntent: PRIVATE, txApprovalLink: PRIVATE,
      approval: { approvalId: PRIVATE, expiresAt: EXPIRES, violations: [{ reason: PRIVATE }] }, ...this.patch });
    this.bodies.push(body); return { status: 200, body };
  }
}

test("the tx is the one mm 6.1.5 built from 0.5.107's payload: lowercase addresses, numeric nonce, gas as gasLimit, minimal hex", () => {
  assert.deepEqual(metaMaskCliPayloadTx(PAYLOAD, OWNER, 1), { from: OWNER, to: USDC.toLowerCase(), chainId: 1, data: DATA, value: "0x0", nonce: 7,
    gasLimit: "0xfde8", maxFeePerGas: "0xc8", maxPriorityFeePerGas: "0x2" });
  assert.deepEqual(Object.keys(metaMaskCliPayloadTx(PAYLOAD, OWNER, 1)), ["from", "to", "chainId", "data", "value", "nonce", "gasLimit", "maxFeePerGas",
    "maxPriorityFeePerGas"], "preparedToRemoteTx's field order");
  // mm parses each quantity with BigInt and writes it back as 0x${value.toString(16)}; `from` is the session's wallet, lowercased.
  const spelled = metaMaskCliPayloadTx({ ...PAYLOAD, gas: "0x00FDE8", nonce: "0x0", maxFeePerGas: "0xC8" }, "0x1111111111111111111111111111111111111111", 10);
  assert.deepEqual([spelled.gasLimit, spelled.nonce, spelled.maxFeePerGas, spelled.chainId], ["0xfde8", 0, "0xc8", 10]);
  for (const bad of [{ ...PAYLOAD, value: "0x1" }, { ...PAYLOAD, nonce: "0x20000000000000" }, { ...PAYLOAD, to: "0x5555" }, { ...PAYLOAD, gas: "65000" },
    { ...PAYLOAD, data: "a9059cbb" }, { ...PAYLOAD, extra: "0x0" }, (({ gas: _gas, ...rest }) => rest)(PAYLOAD)]) {
    assert.throws(() => metaMaskCliPayloadTx(bad as unknown as typeof PAYLOAD, OWNER, 1), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL",
      JSON.stringify(bad));
  }
});

test("the helper POSTs exactly the bytes the SDK's server adapter sends, once, with the session's own token", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = new TransactionExchange({ status: "AWAITING_MFA" });
  const result = await executeHelperRequest(submit(input()), { homeDirectory: home.home, exchange });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true, result: { requestId: RID, status: "AWAITING_MFA", txHash: null,
    mfa: { expiresAt: EXPIRES, authMethod: "qr" }, responseHash: sha256(exchange.bodies[0]!) } });
  assert.equal(JSON.stringify(result).includes(PRIVATE), false, "no approval detail, link or other metadata leaves the helper");
  assert.equal(exchange.requests.length, 1); assert.equal(exchange.beforeSends, 1);
  const [request] = exchange.requests;
  assert.deepEqual([request!.url, request!.method, request!.headers.authorization, request!.headers["content-type"]],
    [COLLECTION, "POST", `Bearer ${home.token}`, "application/json"]);
  // What mm 6.1.5 POSTs for the same --chain-id 1 --payload and --intent, with APN's id in place of the one it generated.
  assert.equal(request!.body, JSON.stringify({ requestId: RID, namespace: "evm", chainId: 1, tx: { from: OWNER, to: USDC.toLowerCase(), chainId: 1,
    data: DATA, value: "0x0", nonce: 7, gasLimit: "0xfde8", maxFeePerGas: "0xc8", maxPriorityFeePerGas: "0x2" }, txIntent: INTENT }));
  assert.equal(request!.body, serverTransactionBody(input()));
  assert.equal(await readFile(join(home.directory, "session.json"), "utf8"), home.sessionBytes);
  assert.equal(await readFile(join(home.directory, "wallets.json"), "utf8"), home.walletBytes);
  // A status that is not AWAITING_MFA carries no approval window; a hash is kept only in its exact form.
  const signed = new TransactionExchange({ status: "BROADCASTED", txHash: `0x${"44".repeat(32)}` });
  const answer = await executeHelperRequest(submit(input()), { homeDirectory: home.home, exchange: signed });
  assert.deepEqual(answer.ok && answer.result, { requestId: RID, status: "BROADCASTED", txHash: `0x${"44".repeat(32)}`, mfa: null,
    responseHash: sha256(signed.bodies[0]!) });
});

test("the network policy admits the one exact POST and refuses another body, URL, token or a second request before it leaves", async () => {
  const token = "synthetic-token", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const policyFor = () => { const exchange = new TransactionExchange(); return { exchange,
    policy: new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date()), exchange) }; };
  const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.details?.reason === reason;
  let { exchange, policy } = policyFor();
  const sent = await policy.fetch(COLLECTION, { method: "POST", headers, body: serverTransactionBody(input()) });
  assert.equal(sent.status, 200); assert.equal(exchange.requests.length, 1); policy.assertComplete();
  assert.deepEqual(policy.submitFacts(), { post: "sent", httpStatus: 200, check: "none", providerError: null });
  await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers, body: serverTransactionBody(input()) }), refused("mm_gasless_submit_unknown"));
  assert.equal(exchange.requests.length, 1, "a second request never leaves"); assert.equal(policy.submitFacts().check, "duplicate_request");
  const reordered = JSON.stringify({ namespace: "evm", ...JSON.parse(serverTransactionBody(input())) });
  const other = serverTransactionBody(input({ tx: { ...input().tx, nonce: 8 } }));
  for (const body of [other, reordered, serverTransactionBody(input({ intent: "APN another intent" })), serverTransactionBody(input({ requestId: "5d1f6a2e-3b4c-4d5e-8f60-718293a4b5c7" }))]) {
    ({ exchange, policy } = policyFor());
    await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers, body }), refused("mm_gasless_submit_unknown"));
    assert.equal(exchange.requests.length, 0); assert.deepEqual([policy.submitFacts().post, policy.submitFacts().check], ["refused", "body_mismatch"]);
    assert.throws(() => policy.assertComplete(), refused("mm_gasless_submit_unknown"));
  }
  for (const [url, method] of [[`${COLLECTION}/${RID}`, "GET"], [COLLECTION.replace(PROJECT, "another-project"), "POST"],
    [`https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/approval/${RID}?id_type=requestId`, "GET"],
    [`https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/signature-requests`, "POST"]] as const) {
    ({ exchange, policy } = policyFor());
    await assert.rejects(policy.fetch(url, { method, headers, ...(method === "POST" ? { body: serverTransactionBody(input()) } : {}) }));
    assert.equal(exchange.requests.length, 0, url);
  }
  ({ exchange, policy } = policyFor());
  await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers: { authorization: "Bearer another-token" }, body: serverTransactionBody(input()) }),
    refused("mm_gasless_session_unavailable"));
  assert.equal(exchange.requests.length, 0);
});

test("the send's deadline is checked at the request and again right before its bytes leave; past it nothing is sent", async () => {
  const token = "synthetic-token", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const deadline = Date.parse(DEADLINE);
  let clock = deadline - 1;
  /** An exchange whose transport takes until the deadline before the bytes would go. */
  class SlowExchange extends TransactionExchange {
    override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> { clock = deadline; return await super.request(request); }
  }
  let exchange: TransactionExchange = new SlowExchange();
  let policy = new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date(clock)), exchange);
  await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers, body: serverTransactionBody(input()) }),
    (error: unknown) => error instanceof ApnError && error.details?.reason === "mm_gasless_expired");
  assert.equal(exchange.bodies.length, 0, "the transport never sent the bytes");
  assert.deepEqual([policy.submitFacts().post, policy.submitFacts().check, policy.fixedFailure()], ["not_reached", "deadline", "mm_gasless_expired"]);
  clock = deadline; exchange = new TransactionExchange();
  policy = new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date(clock)), exchange);
  await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers, body: serverTransactionBody(input()) }));
  assert.equal(exchange.requests.length, 0, "past the deadline the request is refused before the transport");
  // In the helper: a deadline already past refuses with nothing sent, and its diagnostic says the POST did not leave.
  const home = await syntheticHome(), past = new Date(Date.now() - 1).toISOString();
  try {
    exchange = new TransactionExchange();
    const result = await executeHelperRequest(submit(input({ expiresAt: past })), { homeDirectory: home.home, exchange });
    assert.equal(result.ok, false); assert.equal(exchange.requests.length, 0);
    assert.deepEqual(!result.ok && [result.failure.reason, result.submitDiagnostic?.post, result.submitDiagnostic?.check],
      ["mm_gasless_expired", "not_reached", "deadline"]);
  } finally { await home.cleanup(); }
});

/** A Node request as the transport sees it: what `end` wrote, and whether it was destroyed. */
class WrittenRequest extends EventEmitter {
  readonly written: (string | undefined)[] = [];
  destroyed = false;
  end(body?: string): this { this.written.push(body); return this; }
  destroy(): this { this.destroyed = true; return this; }
}
/** The production gate on a request whose TLS handshake runs `duringConnect` before it completes. */
class ConnectingExchange implements FetchExchange {
  readonly req = new WrittenRequest();
  timeoutMs: number | undefined;
  constructor(readonly duringConnect: () => void = () => undefined) {}
  async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    this.timeoutMs = request.timeoutMs;
    const socket = new EventEmitter();
    return await new Promise((resolve, reject) => {
      endRequestWhenSecure(this.req as unknown as ClientRequest, request, reject);
      this.req.emit("socket", socket);
      assert.deepEqual(this.req.written, [], "nothing of a send is written before TLS is up");
      this.duringConnect();
      socket.emit("secureConnect");
      if (this.req.written.length === 1) {
        const posted = JSON.parse(this.req.written[0]!) as { requestId: string; tx: unknown };
        resolve({ status: 200, body: JSON.stringify({ requestId: posted.requestId, status: "EVALUATING", tx: posted.tx }) });
      }
    });
  }
}

test("a send is written only once TLS is up, after its last deadline check, and its exchange ends at the deadline", async () => {
  const token = "synthetic-token", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const deadline = Date.parse(DEADLINE), body = serverTransactionBody(input());
  let clock = deadline - 1;
  // The deadline passes while DNS, TCP or the handshake run: nothing is written and the request is destroyed.
  let exchange = new ConnectingExchange(() => { clock = deadline; });
  let policy = new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date(clock)), exchange);
  await assert.rejects(policy.fetch(COLLECTION, { method: "POST", headers, body }),
    (error: unknown) => error instanceof ApnError && error.details?.reason === "mm_gasless_expired");
  assert.deepEqual([exchange.req.written, exchange.req.destroyed, exchange.timeoutMs], [[], true, 1]);
  assert.deepEqual([policy.submitFacts().post, policy.submitFacts().check, policy.fixedFailure()], ["not_reached", "deadline", "mm_gasless_expired"]);
  // Before it, the exact bytes go once TLS is up, and the exchange's timeout is the time left to the deadline.
  clock = deadline - 4_000; exchange = new ConnectingExchange();
  policy = new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date(clock)), exchange);
  assert.equal((await policy.fetch(COLLECTION, { method: "POST", headers, body })).status, 200);
  assert.deepEqual([exchange.req.written, exchange.req.destroyed, exchange.timeoutMs, policy.submitFacts().post], [[body], false, 4_000, "sent"]);
  // A deadline further away than the transport's own bound keeps that bound.
  clock = deadline - 3_600_000; exchange = new ConnectingExchange();
  policy = new HelperNetworkPolicy(networkContextServerTransaction(input(), PROJECT, token, () => new Date(clock)), exchange);
  await policy.fetch(COLLECTION, { method: "POST", headers, body });
  assert.equal(exchange.timeoutMs, 15_000);
  // A read has no gate and is written at once.
  const read = new WrittenRequest();
  endRequestWhenSecure(read as unknown as ClientRequest, { body: null }, () => assert.fail("a read has no gate"));
  assert.deepEqual(read.written, [undefined]);
});

test("a malformed request, another project or another selected wallet refuses in the helper before any network call", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const good = input();
  for (const bad of [{ ...good, requestId: RID.toUpperCase() }, { ...good, requestId: "5d1f6a2e-3b4c-1d5e-8f60-718293a4b5c6" },
    { ...good, expiresAt: "tomorrow" }, (({ expiresAt: _deadline, ...rest }) => rest)(good),
    { ...good, projectHash: "abc" }, { ...good, intent: ` ${INTENT}` }, { ...good, intent: "" }, { ...good, extra: true },
    { ...good, tx: { ...good.tx, from: "0x1111111111111111111111111111111111111111".replace("0x1", "0xA") } },
    { ...good, tx: { ...good.tx, to: USDC } }, { ...good, tx: { ...good.tx, value: "0x1" } }, { ...good, tx: { ...good.tx, nonce: 1.5 } },
    { ...good, tx: { ...good.tx, gasLimit: "0x0fde8" } }, { ...good, tx: { ...good.tx, data: DATA.toUpperCase().replace("0X", "0x") } },
    { ...good, tx: { ...good.tx, chainId: 0 } }, { ...good, tx: { ...good.tx, signedTransaction: "0x01" } }]) {
    assert.throws(() => helperRequest(submit(bad)), (error: unknown) => error instanceof ApnError && error.details?.reason === "mm_gasless_input");
    const exchange = new TransactionExchange();
    assert.deepEqual(await executeHelperRequest(submit(bad), { homeDirectory: home.home, exchange }),
      { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_INVALID_INPUT", reason: "mm_gasless_input" } });
    assert.equal(exchange.requests.length, 0);
  }
  const notSent = (result: unknown) => {
    const r = result as { ok: boolean; failure: { reason: string }; submitDiagnostic: { stage: string; post: string } };
    return [r.ok, r.failure.reason, r.submitDiagnostic.post];
  };
  let exchange = new TransactionExchange();
  assert.deepEqual(notSent(await executeHelperRequest(submit(input({ projectHash: sha256("another-project") })), { homeDirectory: home.home, exchange })),
    [false, "mm_gasless_binding_changed", "not_reached"]);
  assert.equal(exchange.requests.length, 0);
  // The revoke names no project: the session's own project, whichever it is, sends the disable.
  exchange = new TransactionExchange();
  assert.equal((await executeHelperRequest(submit(input({ projectHash: null })), { homeDirectory: home.home, exchange })).ok, true);
  assert.equal(exchange.requests.length, 1);
  const other = "0x2222222222222222222222222222222222222222";
  const elsewhere = await syntheticHome({ ref: { address: other }, remoteWallets: [{ address: OWNER, namespace: "evm" }, { address: other, namespace: "evm" }] });
  t.after(elsewhere.cleanup);
  exchange = new TransactionExchange();
  assert.deepEqual(notSent(await executeHelperRequest(submit(input()), { homeDirectory: elsewhere.home, exchange })),
    [false, "mm_gasless_binding_changed", "not_reached"]);
  assert.equal(exchange.requests.length, 0);
  const expired = await syntheticHome({ exp: Math.floor(Date.now() / 1000) - 1 }); t.after(expired.cleanup);
  exchange = new TransactionExchange();
  assert.deepEqual(notSent(await executeHelperRequest(submit(input()), { homeDirectory: expired.home, exchange })),
    [false, "mm_gasless_session_expired", "not_reached"]);
  assert.equal(exchange.requests.length, 0);
});

test("a refusing or malformed answer after the POST fails with its closed check, never a refusal before the send", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const failed = async (exchange: TransactionExchange) => {
    const result = await executeHelperRequest(submit(input()), { homeDirectory: home.home, exchange });
    assert.equal(result.ok, false); assert.equal(exchange.requests.length, 1);
    return !result.ok && result.submitDiagnostic;
  };
  assert.deepEqual(await failed(new TransactionExchange({}, 422, JSON.stringify({ error: { code: "POLICY_VIOLATION", message: PRIVATE } }))),
    { mode: "submit", stage: "post", post: "sent", httpStatus: 422, check: "http_status", providerError: "POLICY_VIOLATION", providerStatus: null, responseTx: null });
  assert.deepEqual(await failed(new TransactionExchange({}, 401)),
    { mode: "submit", stage: "post", post: "sent", httpStatus: 401, check: "session", providerError: null, providerStatus: null, responseTx: null });
  for (const [patch, check] of [[{ requestId: "00000000-0000-4000-8000-000000000099" }, "response_request_id"], [{ status: "evaluating" }, "response_status"],
    [{ tx: { from: "0x9999999999999999999999999999999999999999", chainId: 1 } }, "response_tx"], [{ txHash: `0x${"AB".repeat(32)}` }, "response_hash"]] as const) {
    const diagnostic = await failed(new TransactionExchange(patch));
    assert.deepEqual(diagnostic && [diagnostic.stage, diagnostic.post, diagnostic.httpStatus, diagnostic.check], ["response", "sent", 200, check]);
  }
});

test("the parent sends once through the helper and keeps every failure after the start unknown, with its diagnostic", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  let exchange = new TransactionExchange({ status: "SIGNING" }), runs = 0, failure: unknown, forged: unknown;
  const runner: MetaMaskGaslessHelperRunner = { async run(request, options) {
    runs += 1; assert.equal(options.timeoutMs, 4321, "the caller's kill bound"); assert.equal(request.mode, "submitTransaction");
    if (failure !== undefined) throw failure;
    return forged ?? await executeHelperRequest(request, { homeDirectory: home.home, exchange });
  } };
  const client = new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => new Date() }, runner });
  assert.deepEqual(await sendMetaMaskServerTransaction(input(), 4321, client), { kind: "answered",
    answer: { requestId: RID, status: "SIGNING", txHash: null, mfa: null, responseHash: sha256(exchange.bodies[0]!) } });
  failure = submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_timeout", true));
  const timedOut = await sendMetaMaskServerTransaction(input(), 4321, client);
  assert.equal(timedOut.kind, "unknown"); assert.equal(timedOut.kind === "unknown" && timedOut.reason, "provider_handoff_outcome_unknown");
  assert.equal(timedOut.kind === "unknown" && timedOut.diagnostic?.check, "runner_timeout");
  failure = new Error("TEST the runner itself failed");
  const lost = await sendMetaMaskServerTransaction(input(), 4321, client);
  assert.deepEqual(lost.kind === "unknown" && [lost.reason, lost.diagnostic?.post], ["provider_handoff_outcome_unknown", "unknown"]);
  failure = undefined; exchange = new TransactionExchange({ requestId: "00000000-0000-4000-8000-000000000099" });
  const conflict = await sendMetaMaskServerTransaction(input(), 4321, client);
  assert.equal(conflict.kind === "unknown" && conflict.reason, "provider_request_identity_conflict");
  // A helper answer that is not exactly the bound fields, or names another request, is never taken as the server's.
  forged = { version: MM_HELPER_VERSION, ok: true, result: { requestId: RID, status: "SIGNING", txHash: null, mfa: null, responseHash: "1".repeat(64), link: PRIVATE } };
  assert.deepEqual((await sendMetaMaskServerTransaction(input(), 4321, client)).kind, "unknown");
  // The client binds the helper's answer to the request it sent: one naming another id is never taken.
  forged = { version: MM_HELPER_VERSION, ok: true, result: { requestId: "00000000-0000-4000-8000-000000000099", status: "SIGNING", txHash: null, mfa: null,
    responseHash: "1".repeat(64) } };
  const named = await sendMetaMaskServerTransaction(input(), 4321, client);
  assert.deepEqual(named.kind === "unknown" && [named.reason, named.diagnostic?.check], ["provider_handoff_outcome_unknown", "response_invalid"]);
  forged = { version: MM_HELPER_VERSION, ok: true, result: { requestId: RID, status: "SIGNING", txHash: null, mfa: { expiresAt: EXPIRES, authMethod: "qr" },
    responseHash: "1".repeat(64) } };
  assert.equal((await sendMetaMaskServerTransaction(input(), 4321, client)).kind, "unknown", "an MFA window only for AWAITING_MFA");
  assert.equal(runs, 7);
  // Any other port is held to the same request id: its answer for another request is never taken.
  const other = { async submitServerTransaction() { return { requestId: "00000000-0000-4000-8000-000000000099", status: "SIGNING", txHash: null,
    mfa: null, responseHash: "1".repeat(64) }; } };
  assert.deepEqual(await sendMetaMaskServerTransaction(input(), 4321, other), { kind: "unknown", reason: "provider_request_identity_conflict" });
});
