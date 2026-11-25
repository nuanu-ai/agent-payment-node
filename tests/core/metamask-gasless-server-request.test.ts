import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { getAddress } from "viem";
import { sha256 } from "../../src/canonical.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION, type MetaMaskGaslessHelperRunner } from
  "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { isSafeFailureDescription } from "../../src/metamask-gasless/client/provider-failure.js";
import { readMetaMaskNativeServerRequest } from "../../src/metamask-native-request-server-read.js";
import { NOW, OWNER, PROJECT, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

// A native transfer's request, read straight from MetaMask's server by its exact id when mm's local request list lost it.
const RID = "8cc50f3c-0000-4000-8000-000000000001";
const PRIVATE = "private_provider_metadata_canary";
const REQUEST_URL = `https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/transaction-requests/${RID}`;
const query = (patch: Record<string, unknown> = {}) => ({ requestId: RID, projectHash: sha256(PROJECT), sender: OWNER, chainId: 1, ...patch });
const read = (patch: Record<string, unknown> = {}) => ({ version: MM_HELPER_VERSION, mode: "readRequest", query: query(patch) });

/** The fixture's job answer with `patch` merged in, and the exact bytes it answered. */
class RequestExchange extends SdkExchange {
  readonly bodies: string[] = [];
  constructor(readonly patch: Record<string, unknown> = {}, status = 200) { super(1, status); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (response.status !== 200 || !request.url.includes("/transaction-requests/")) return response;
    const body = JSON.stringify({ ...JSON.parse(response.body), kind: "transaction", chainName: "ethereum", txIntent: PRIVATE,
      approval: { expiresAt: "2030-01-01T00:10:00.000Z", link: `https://provider.example/${PRIVATE}` }, ...this.patch });
    this.bodies.push(body); return { ...response, body };
  }
}

test("one GET of the request's own status in the session's project, checked and reduced to bound fields", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  for (const [patch, status, txHash] of [[{}, "CONFIRMED", `0x${"44".repeat(32)}`], [{ status: "EXPIRED", txHash: undefined }, "EXPIRED", null],
    [{ status: "AWAITING_MFA", txHash: null }, "AWAITING_MFA", null], [{ status: "BROADCAST_FAILED", txHash: undefined }, "BROADCAST_FAILED", null]] as const) {
    const exchange = new RequestExchange(patch);
    const result = await executeHelperRequest(read(), { homeDirectory: home.home, now: () => NOW, exchange });
    // AWAITING_MFA alone carries the owner's window: the job's exact approval.expiresAt and the session's authMethod.
    const mfa = status === "AWAITING_MFA" ? { expiresAt: "2030-01-01T00:10:00.000Z", authMethod: "qr" } : null;
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true,
      result: { requestId: RID, found: true, status, txHash, mfa, failure: null, responseHash: sha256(exchange.bodies[0]!) } });
    assert.equal(JSON.stringify(result).includes(PRIVATE), false, "no approval detail, link or other metadata leaves the helper");
    assert.equal(exchange.requests.length, 1); assert.equal(exchange.requests[0]!.url, REQUEST_URL); assert.equal(exchange.requests[0]!.method, "GET");
    assert.equal(exchange.requests[0]!.headers.authorization, `Bearer ${home.token}`); assert.equal(exchange.beforeSends, 0);
  }
  assert.equal(await readFile(join(home.directory, "session.json"), "utf8"), home.sessionBytes);
  assert.equal(await readFile(join(home.directory, "wallets.json"), "utf8"), home.walletBytes);
});

test("another signed-in project, an expired session or a malformed query refuses before anything is read", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  let exchange = new RequestExchange();
  assert.deepEqual(await executeHelperRequest(read({ projectHash: sha256("another-project") }), { homeDirectory: home.home, now: () => NOW, exchange }),
    { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_PROFILE_DRIFT", reason: "mm_gasless_binding_changed" } });
  assert.equal(exchange.requests.length, 0);
  for (const patch of [{ requestId: "8cc50f3c-0000-4000-8000-00000000000" }, { requestId: "../wallets" }, { requestId: RID.toUpperCase() },
    { sender: "0xAAAA111111111111111111111111111111111111" }, { chainId: 0 }, { extra: true }]) {
    exchange = new RequestExchange();
    const refused = await executeHelperRequest(read(patch), { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(refused, { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_INVALID_INPUT", reason: "mm_gasless_input" } });
    assert.equal(exchange.requests.length, 0);
  }
  const expired = await syntheticHome({ exp: Math.floor(NOW.getTime() / 1000) - 1 }); t.after(expired.cleanup);
  exchange = new RequestExchange();
  assert.deepEqual(await executeHelperRequest(read(), { homeDirectory: expired.home, now: () => NOW, exchange }),
    { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_expired" } });
  assert.equal(exchange.requests.length, 0);
});

// The SDK itself stamps `kind: "transaction"` on a transaction job's answer, so no server answer can reach the kind check.
test("an answer naming another request, sender or chain, or with another status or hash form, refuses with its check", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const tx = (from: string, chainId: string, chainIdMatches: boolean | null) => ({ tx: "object", from, chainId, chainIdMatches });
  for (const [patch, check, providerStatus, responseTx] of [
    [{ requestId: "00000000-0000-4000-8000-000000000099" }, "response_request_id", null, null],
    [{ status: "confirmed" }, "response_status", null, null], [{ status: 7 }, "response_status", null, null],
    [{ tx: { from: "0x9999999999999999999999999999999999999999", chainId: 1 } }, "response_tx", "CONFIRMED", tx("other_address", "number", true)],
    [{ tx: { from: OWNER, chainId: 10 } }, "response_tx", "CONFIRMED", tx("owner", "number", false)],
    [{ tx: { from: OWNER, chainId: "0x1" } }, "response_tx", "CONFIRMED", tx("owner", "hex_string", true)],
    [{ tx: null }, "response_tx", "CONFIRMED", { tx: "null", from: null, chainId: null, chainIdMatches: null }],
    [{ txHash: `0x${"AB".repeat(32)}` }, "response_hash", null, null], [{ txHash: "0x01" }, "response_hash", null, null],
  ] as const) {
    const exchange = new RequestExchange(patch);
    assert.deepEqual(await executeHelperRequest(read(), { homeDirectory: home.home, now: () => NOW, exchange }), { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" },
      observeDiagnostic: { mode: "observe", check, providerStatus, responseTx } }, check);
    assert.equal(exchange.requests.length, 1);
  }
  const missing = new RequestExchange({}, 404);
  assert.deepEqual(await executeHelperRequest(read(), { homeDirectory: home.home, now: () => NOW, exchange: missing }),
    { version: MM_HELPER_VERSION, ok: true, result: { requestId: RID, found: false, status: null, txHash: null, mfa: null, failure: null, responseHash: null } });
  assert.equal(missing.requests.length, 1);
  const denied = new RequestExchange({}, 401);
  assert.deepEqual(await executeHelperRequest(read(), { homeDirectory: home.home, now: () => NOW, exchange: denied }),
    { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_unavailable" } });
});

test("the native read runs through the parent client and names every refusal precisely", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  let exchange = new RequestExchange(), runs = 0;
  const runner: MetaMaskGaslessHelperRunner = { async run(request) { runs += 1; return executeHelperRequest(request,
    { homeDirectory: home.home, now: () => NOW, exchange }); } };
  const client = new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => NOW }, runner });
  const sender = getAddress(OWNER);
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, client),
    { outcome: "verified", status: "CONFIRMED", transactionHash: `0x${"44".repeat(32)}`, mfa: null, failure: null, responseHash: sha256(exchange.bodies[0]!) });
  exchange = new RequestExchange({ status: "AWAITING_MFA", txHash: null });
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, client),
    { outcome: "verified", status: "AWAITING_MFA", transactionHash: null, mfa: { expiresAt: "2030-01-01T00:10:00.000Z", authMethod: "qr" },
      failure: null, responseHash: sha256(exchange.bodies[0]!) });
  exchange = new RequestExchange({ status: "AWAITING_MFA", txHash: null, approval: { expiresAt: "soon" } });
  assert.deepEqual((await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, client)) as unknown,
    { outcome: "verified", status: "AWAITING_MFA", transactionHash: null, mfa: { expiresAt: null, authMethod: "qr" }, failure: null,
      responseHash: sha256(exchange.bodies[0]!) },
    "a window not in its exact form is null, never guessed");
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256("another-project"), { sender, chainId: 1 }, client),
    { outcome: "refused", reason: "metamask_session_project_changed", check: null });
  exchange = new RequestExchange({ tx: { from: OWNER, chainId: 10 } });
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, client),
    { outcome: "refused", reason: "mm_gasless_provider_unavailable", check: "response_tx" });
  exchange = new RequestExchange({}, 404);
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, client), { outcome: "not_found" });
  const before = runs;
  for (const id of ["TEST-pending-request", RID.toUpperCase(), ""]) assert.deepEqual(await readMetaMaskNativeServerRequest(id, sha256(PROJECT),
    { sender, chainId: 1 }, client), { outcome: "refused", reason: "provider_request_binding_invalid", check: null });
  assert.equal(runs, before, "an id that is not a canonical UUID never reaches the helper");
});

// 0.5.118, QA on the live Base revoke: MetaMask answered FAILED with failureCode POLICY_EVALUATOR_FAILED and the
// description "Policy evaluator outflow.limit_usd degraded: unavailable", and APN showed only the status.
const POLICY = "Policy evaluator outflow.limit_usd degraded: unavailable";
const CREDENTIALS = "Bearer PRIVATE https://rpc.invalid/?key=PRIVATE Authorization: PRIVATE";

test("a failed job's own code and description leave the helper only in their closed form", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const kept = (code: string | null, description: string | null, codeWithheld = false, descriptionWithheld = false) =>
    ({ code, codeWithheld, description, descriptionWithheld });
  for (const [patch, failure] of [
    [{ failureCode: "POLICY_EVALUATOR_FAILED", failureDescription: POLICY }, kept("POLICY_EVALUATOR_FAILED", POLICY)],
    [{ failureCode: "POLICY_EVALUATOR_FAILED" }, kept("POLICY_EVALUATOR_FAILED", null)],
    [{ failureCode: "POLICY_EVALUATOR_FAILED", failureDescription: CREDENTIALS }, kept("POLICY_EVALUATOR_FAILED", null, false, true)],
    [{ failureCode: "policy evaluator failed", failureDescription: "Outflow limit exceeded (daily, USD)" },
      kept(null, "Outflow limit exceeded (daily, USD)", true, false)],
    [{ failureCode: 7, failureDescription: { text: PRIVATE } }, kept(null, null, true, true)],
    [{ failureCode: "", failureDescription: "" }, kept(null, null, true, true)],
    [{ failureCode: null, failureDescription: null }, null],
  ] as const) {
    const exchange = new RequestExchange({ status: "FAILED", txHash: null, ...patch });
    const result = await executeHelperRequest(read(), { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true,
      result: { requestId: RID, found: true, status: "FAILED", txHash: null, mfa: null, failure, responseHash: sha256(exchange.bodies[0]!) } },
      JSON.stringify(patch));
    for (const secret of ["PRIVATE", PRIVATE, "rpc.invalid"]) assert.equal(JSON.stringify(result).includes(secret), false, secret);
    assert.equal(exchange.requests.length, 1); assert.equal(exchange.requests[0]!.method, "GET"); assert.equal(exchange.beforeSends, 0);
  }
});

test("only short plain prose passes as a failure description", () => {
  for (const text of [POLICY, "Outflow limit exceeded (daily, USD)", "Insufficient funds for gas", "Request expired before approval"]) {
    assert.equal(isSafeFailureDescription(text), true, text);
  }
  for (const text of ["", "x".repeat(201), "see https://status.example", "key=abc", "owner@example.com", "line\nbreak", "tab\there",
    "Bearer abc", "Session expired", "Invalid token", "API key revoked", "sender 0x1111111111111111111111111111111111111111",
    "request 8cc50f3c-0000-4000-8000-000000000001", "nonce deadbeef", "id abcdefgh12", "ключ отклонён", 'quoted "text"', "a+b", "100%",
    "path\\name", "hash #1", "x & y"]) {
    assert.equal(isSafeFailureDescription(text), false, text);
  }
});

test("the parent refuses a failure the helper did not give in its closed form", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const sender = getAddress(OWNER);
  const reading = (status: number, failure: unknown) => {
    const exchange = new RequestExchange({ status: "FAILED", txHash: null, failureCode: "POLICY_EVALUATOR_FAILED", failureDescription: POLICY }, status);
    const runner: MetaMaskGaslessHelperRunner = { async run(request) {
      const response = await executeHelperRequest(request, { homeDirectory: home.home, now: () => NOW, exchange }) as unknown as { result: Record<string, unknown> };
      return failure === undefined ? response : { ...response, result: { ...response.result, failure } };
    } };
    return new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => NOW }, runner });
  };
  const verified = await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, reading(200, undefined));
  assert.deepEqual(verified.outcome === "verified" && [verified.status, verified.transactionHash, verified.failure],
    ["FAILED", null, { code: "POLICY_EVALUATOR_FAILED", codeWithheld: false, description: POLICY, descriptionWithheld: false }]);
  for (const failure of [
    { code: "policy", codeWithheld: false, description: null, descriptionWithheld: false },
    { code: null, codeWithheld: false, description: CREDENTIALS, descriptionWithheld: false },
    { code: "POLICY_EVALUATOR_FAILED", codeWithheld: true, description: null, descriptionWithheld: false },
    { code: null, codeWithheld: false, description: POLICY, descriptionWithheld: true },
    { code: null, codeWithheld: false, description: null, descriptionWithheld: false },
    { code: null, codeWithheld: "no", description: null, descriptionWithheld: true },
    { code: "POLICY_EVALUATOR_FAILED", codeWithheld: false, description: null, descriptionWithheld: false, extra: true },
    "POLICY_EVALUATOR_FAILED",
  ]) {
    assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 }, reading(200, failure)),
      { outcome: "refused", reason: "mm_gasless_provider_unavailable", check: null }, JSON.stringify(failure));
  }
  // A 404 names no job, so it can name no failure.
  assert.deepEqual(await readMetaMaskNativeServerRequest(RID, sha256(PROJECT), { sender, chainId: 1 },
    reading(404, { code: "POLICY_EVALUATOR_FAILED", codeWithheld: false, description: null, descriptionWithheld: false })),
    { outcome: "refused", reason: "mm_gasless_provider_unavailable", check: null });
});
