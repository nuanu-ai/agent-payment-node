/**
 * Regression: a Base gasless transfer posted its delegation to a MetaMask project that held no server wallet; Mimir
 * answered 404 PROJECT_NOT_FOUND after the POST had left, so the operation ended unknown and held the account. Every
 * quote (prepare, and the fresh quote of approve's guard) now reads the session project's wallet list first; the
 * submit itself is unchanged. These run the real vendored SDK against a synthetic provider.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { metaMaskCommand } from "../../src/metamask-command.js";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import { HelperNetworkPolicy, networkContextQuote, networkContextRequest, type FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { validateReadDiagnostic } from "../../src/metamask-gasless/client/read-diagnostic.js";
import type { MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { mmProjectWalletNextActions } from "../../src/metamask-gasless/project-wallet-guidance.js";
import { expectedQuote, intent, NOW, OWNER, PROJECT, PROJECT_WALLETS_URL, quoteInput, SECRET, SdkExchange, syntheticHome } from
  "./metamask-gasless-client-fixtures/sdk.js";
import { MmTestRpc, mmFixture } from "./metamask-gasless-helpers.js";

const OTHER_A = "0x4444444444444444444444444444444444444444", OTHER_B = "0x5555555555555555555555555555555555555555";
const OTHER_C = "0x6666666666666666666666666666666666666666", SOLANA = "So11111111111111111111111111111111111111112";
const OTHERS = [OTHER_A, OTHER_B, OTHER_C];
const ENDPOINT = "https://agentic-mimir-service.api.cx.metamask.io/v1/projects/{projectId}/wallets";
const answer = (status: number, body: unknown) => (): FetchExchangeResponse =>
  ({ status, body: typeof body === "string" ? body : JSON.stringify(body) });
const read = (facts: Record<string, unknown> = {}) => ({ mode: "quote", stage: "project_wallets", invariant: "closed_failure", network: "none",
  httpStatus: null, exitCode: null, signal: "none", timedOut: false, ...facts });
const failure = (reason: string) => ({ code: reason === "mm_gasless_provider_unavailable" ? "APN_PROVIDER_UNAVAILABLE" : "APN_PROVIDER_SESSION_REQUIRED", reason });
const exchangeAnswering = (wallets: () => FetchExchangeResponse) => { const e = new SdkExchange(8453); e.projectWallets = wallets; return e; };

async function quoteWith(t: TestContext, wallets: () => FetchExchangeResponse) {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = exchangeAnswering(wallets);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  return { home, exchange, result };
}
/** The parent's error for a helper quote against `exchange`, quoted under profile `revision`. */
async function clientQuoteError(exchange: SdkExchange, revision?: number): Promise<ApnError> {
  const home = await syntheticHome();
  try {
    const client = new MetaMaskGaslessProviderClient({ runner: { run: async (request) =>
      await executeHelperRequest(structuredClone(request), { homeDirectory: home.home, now: () => NOW, exchange }) } });
    const binding = revision === undefined ? home.binding : { ...home.binding, revision };
    const error = await client.quote(quoteInput(binding, 8453)).then(() => assert.fail("expected a refusal"), (e: unknown) => e);
    assert.ok(error instanceof ApnError);
    for (const secret of [PROJECT, home.token, SECRET, ...OTHERS]) assert.equal(JSON.stringify([error.message, error.details]).includes(secret), false);
    return error;
  } finally { await home.cleanup(); }
}
/** The next actions as the owner reads them, for profile `mm-fixture` at `revision`. */
async function expectedActions(kind: "none" | "others", revision: number, which?: string) {
  const mm = await metaMaskCommand(), connect = "apn wallet connect --profile mm-fixture --provider metamask-agent-wallet --auth-method browser";
  const keep = `To keep paying from ${OWNER}, sign in to MetaMask with the account that created it: ${mm} logout, then ${mm} login ` +
    `(then ${mm} wallet select ${OWNER} if that account holds more than one wallet), then connect this profile again with ${connect}. ` +
    "The address stays the same, so no revision is needed.";
  return [keep, kind === "none"
    ? `Or create this project's first server wallet with ${mm} init --wallet server-wallet --mode guard --json and connect it with ` +
      `${connect} --expected-revision ${revision}. That is a new address: funds on ${OWNER} stay with the login that created it.`
    : `Or pay from ${which} this login's project holds instead of ${OWNER}: ${mm} init would only select one of them (it creates ` +
      `no wallet) and keep that wallet's server-side trading mode. List them with ${mm} wallet list, select one with ${mm} wallet ` +
      `select, then connect it with ${connect} --expected-revision ${revision}. Funds on ${OWNER} stay with the login that created it.`];
}

test("a project listing the bound wallet lets the quote run as before, after one exact bearer read", async (t) => {
  for (const wallets of [answer(200, { wallets: [{ address: OWNER, name: "primary", namespace: "evm" }] }),
    answer(200, { wallets: [{ address: SOLANA, namespace: "solana" }, { address: OWNER }], next: null }),
    answer(200, { wallets: [{ address: OWNER, namespace: "eip155" }] })]) {
    const { home, exchange, result } = await quoteWith(t, wallets);
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(8453) });
    const first = exchange.requests[0]!;
    assert.deepEqual([first.method, first.url, first.body, first.headers], ["GET", PROJECT_WALLETS_URL, null, { authorization: `Bearer ${home.token}` }]);
    assert.equal(exchange.requests.length, 7); assert.equal(exchange.requests.filter(r => r.url === PROJECT_WALLETS_URL).length, 1);
    assert.equal(exchange.beforeSends, 0);
  }
});

test("the submit reads no project wallet list: its one POST is the first and only request, as before", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId: 8453, executions: expectedQuote(8453).executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, 8453, expectedQuote(8453), built.result as MetaMaskGaslessUnsignedResult);
  const exchange = exchangeAnswering(answer(404, "{}"));
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(exchange.requests.map(r => [r.method, r.url.split("/").at(-1)]), [["POST", "transaction-requests"]]);
  const gate = new HelperNetworkPolicy(networkContextRequest("submit", operation, PROJECT, home.token, () => NOW), new SdkExchange(8453));
  gate.primeSubmitClock(NOW);
  await assert.rejects(gate.fetch(PROJECT_WALLETS_URL, { method: "GET", headers: { authorization: `Bearer ${home.token}` } }),
    { details: { reason: "mm_gasless_submit_unknown" } });
  assert.deepEqual(gate.submitFacts(), { post: "not_reached", httpStatus: null, check: "unexpected_request", providerError: null });
});

test("a project with no server wallet refuses the quote before any other read", async (t) => {
  for (const wallets of [answer(404, { error: { code: "PROJECT_NOT_FOUND" } }), answer(200, { wallets: [] }),
    answer(200, { wallets: [{ address: SOLANA, namespace: "solana" }] })]) {
    const { exchange, result } = await quoteWith(t, wallets);
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false, failure: failure("mm_gasless_project_has_no_wallets"), diagnostic: read() });
    assert.equal(exchange.requests.length, 1, "no inventory, RPC or fee read");
  }
  const error = await clientQuoteError(exchangeAnswering(answer(404, { error: { code: "PROJECT_NOT_FOUND" } })));
  assert.equal(error.code, "APN_PROVIDER_SESSION_REQUIRED");
  assert.equal(error.message, `The MetaMask login in mm belongs to a project that has no server wallet, so it does not hold the connected ` +
    `wallet ${OWNER}: MetaMask's project wallet list (${ENDPOINT}) names no EVM server wallet. Nothing was signed or sent.`);
  assert.deepEqual(error.details, { reason: "mm_gasless_project_has_no_wallets", mm_read_mode: "quote", mm_read_stage: "project_wallets",
    mm_read_invariant: "closed_failure", mm_read_network: "none", mm_read_signal: "none", mm_read_timed_out: false,
    provider_read: "metamask project wallet list", provider_endpoint: ENDPOINT, wallet_address: OWNER, profile_revision: 7 });
});

test("a project whose EVM wallets (evm, eip155 or unnamed) do not include the bound one is refused naming only their count", async (t) => {
  const wallets = answer(200, { wallets: [{ address: OTHER_A, namespace: "evm" }, { address: OTHER_B }, { address: OTHER_C, namespace: "eip155" },
    { address: SOLANA, namespace: "solana" }] });
  const { exchange, result } = await quoteWith(t, wallets);
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false, failure: failure("mm_gasless_wallet_not_in_project"),
    diagnostic: read({ projectWalletCount: 3 }) });
  assert.equal(exchange.requests.length, 1);
  const error = await clientQuoteError(exchangeAnswering(wallets));
  assert.equal(error.message, `The MetaMask login in mm belongs to a project that does not hold the connected wallet ${OWNER}: ` +
    `MetaMask's project wallet list (${ENDPOINT}) names 3 other EVM server wallets. Nothing was signed or sent.`);
  assert.equal(error.details?.mm_read_project_wallet_count, 3); assert.equal(error.details?.wallet_address, OWNER);
});

test("an unreadable project wallet list refuses as unavailable, naming the read and its HTTP status", async (t) => {
  const answered = (status: number) => read({ network: "project-wallets", httpStatus: status });
  const validation = read({ invariant: "network_validation", network: "project-wallets", httpStatus: 200 });
  const cases: Array<[string, () => FetchExchangeResponse, Record<string, unknown>]> = [
    ["500", answer(500, "{}"), answered(500)], ["503 text", answer(503, "upstream"), answered(503)],
    ["201", answer(201, { wallets: [{ address: OWNER }] }), answered(201)],
    ["timeout", () => { throw new Error("timeout"); }, read({ invariant: "unclassified_exception", network: "project-wallets" })],
    ["json", answer(200, "{"), validation], ["root", answer(200, []), validation], ["wallets object", answer(200, { wallets: {} }), validation],
    ["null row", answer(200, { wallets: [null] }), validation], ["numeric address", answer(200, { wallets: [{ address: 1 }] }), validation],
    ["null namespace", answer(200, { wallets: [{ address: OWNER, namespace: null }] }), validation],
    ["over 128", answer(200, { wallets: Array(129).fill({ address: OWNER }) }), validation],
  ];
  for (const [name, wallets, diagnostic] of cases) await t.test(name, async (t) => {
    const { exchange, result } = await quoteWith(t, wallets);
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false, failure: failure("mm_gasless_provider_unavailable"), diagnostic });
    assert.equal(exchange.requests.length, 1);
  });
  const error = await clientQuoteError(exchangeAnswering(answer(502, "bad gateway")));
  assert.deepEqual([error.code, error.details?.mm_read_network, error.details?.mm_read_http_status], ["APN_PROVIDER_UNAVAILABLE", "project-wallets", 502]);
  await t.test("401 is the session", async (t) => {
    const { result } = await quoteWith(t, answer(401, "{}"));
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false, failure: { code: "APN_PROVIDER_SESSION_REQUIRED",
      reason: "mm_gasless_session_unavailable" }, diagnostic: answered(401) });
  });
});

test("the quote policy admits only the exact project wallet read, once, with the session bearer", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const quote = () => { const exchange = new SdkExchange(8453);
    return { exchange, policy: new HelperNetworkPolicy(networkContextQuote(quoteInput(home.binding, 8453), OWNER, home.token, PROJECT), exchange) }; };
  const get = (policy: HelperNetworkPolicy, url: string, init: RequestInit = {}) =>
    policy.fetch(url, { method: "GET", headers: { authorization: `Bearer ${home.token}` }, ...init });
  for (const [url, init, code] of [[PROJECT_WALLETS_URL, { headers: { authorization: "Bearer other" } }, "APN_PROVIDER_SESSION_REQUIRED"],
    [PROJECT_WALLETS_URL, { headers: {} }, "APN_PROVIDER_SESSION_REQUIRED"], [`${PROJECT_WALLETS_URL}?limit=1`, {}, "APN_PROVIDER_UNAVAILABLE"],
    [PROJECT_WALLETS_URL.replace(PROJECT, "other-project"), {}, "APN_PROVIDER_UNAVAILABLE"],
    [PROJECT_WALLETS_URL, { method: "POST", body: "{}" }, "APN_PROVIDER_UNAVAILABLE"]] as const) {
    const { exchange, policy } = quote();
    await assert.rejects(get(policy, url, init as RequestInit), { code }, url); assert.equal(exchange.requests.length, 0);
  }
  const { exchange, policy } = quote();
  assert.equal((await get(policy, PROJECT_WALLETS_URL)).status, 200);
  await assert.rejects(get(policy, PROJECT_WALLETS_URL), { code: "APN_PROVIDER_UNAVAILABLE" }, "one read only");
  assert.equal(exchange.requests.length, 1);
});

test("the closed read diagnostic keeps the wallet count on its own refusal only", () => {
  const counted = read({ projectWalletCount: 2 });
  assert.deepEqual(validateReadDiagnostic(counted, "quote"), counted);
  for (const bad of [{ projectWalletCount: 0 }, { projectWalletCount: 129 }, { projectWalletCount: "2" }, { projectWalletCount: null },
    { stage: "inventory" }, { invariant: "network_validation" }, { network: "project-wallets" }]) {
    assert.throws(() => validateReadDiagnostic({ ...counted, ...bad }, "quote"), { code: "APN_PROVIDER_UNAVAILABLE" }, JSON.stringify(bad));
  }
  assert.throws(() => validateReadDiagnostic({ ...counted, mode: "inspect" }, "inspect"), { code: "APN_PROVIDER_UNAVAILABLE" });
});

test("each refusal names its own ways forward; any other wallet's connect names the current revision", async () => {
  const guide = (reason: "mm_gasless_project_has_no_wallets" | "mm_gasless_wallet_not_in_project", otherWallets: number | undefined) =>
    mmProjectWalletNextActions({ reason, profile: "mm-fixture", address: OWNER, revision: 4, otherWallets });
  assert.deepEqual(await guide("mm_gasless_project_has_no_wallets", undefined), await expectedActions("none", 4));
  assert.deepEqual(await guide("mm_gasless_wallet_not_in_project", 1), await expectedActions("others", 4, "the 1 other EVM server wallet"));
  assert.deepEqual(await guide("mm_gasless_wallet_not_in_project", undefined), await expectedActions("others", 4, "the other EVM server wallets"));
  for (const actions of [await guide("mm_gasless_project_has_no_wallets", undefined), await guide("mm_gasless_wallet_not_in_project", 2)]) {
    assert.equal(actions[0]!.includes("--expected-revision"), false, "the same address is no rebind");
    assert.match(actions[1]!, / --expected-revision 4\. /u);
  }
});

test("prepare refused for the login's project names that refusal's ways forward and writes nothing", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-project-wallets-"));
  try {
    const f = await mmFixture(root);
    for (const [key, wallets, reason, expected] of [
      ["mm-project-none", answer(404, "{}"), "mm_gasless_project_has_no_wallets", await expectedActions("none", 1)],
      ["mm-project-others", answer(200, { wallets: [{ address: OTHER_A }, { address: OTHER_B, namespace: "eip155" }] }), "mm_gasless_wallet_not_in_project",
        await expectedActions("others", 1, "the 2 other EVM server wallets")]] as const) {
      const refusal = await clientQuoteError(exchangeAnswering(wallets), f.binding.revision);
      f.provider.quote = async () => { throw refusal; };
      const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: key });
      assert.equal(result.ok, false); assert.equal(result.operation, null);
      assert.deepEqual([result.error?.code, result.error?.details?.reason, result.error?.message], ["APN_PROVIDER_SESSION_REQUIRED", reason, refusal.message]);
      assert.deepEqual(result.next_actions, expected);
      for (const other of OTHERS) assert.equal(JSON.stringify(result).includes(other), false, "no other address is printed");
    }
    assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
    assert.equal(f.provider.submissions.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("while another operation holds the profile, its steps come first, then the refusal's own ways forward", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-project-wallets-"));
  try {
    const f = await mmFixture(root);
    const { id } = await f.prepare(); f.rpc.phase = "pending"; f.rpc.candidate = null;
    assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    assert.equal((await f.record(id)).state, "unknown_finality");
    const refusal = await clientQuoteError(exchangeAnswering(answer(404, "{}")), f.binding.revision);
    f.provider.quote = async () => { throw refusal; };
    const core = new ApnCore({ state: f.state, clock: f.clock, wait: f.wait,
      metaMaskGasless: { ...f.dependencies, rpcFor: chainId => new MmTestRpc(chainId, f.now) } });
    const held = await core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: { ...f.request, chainId: 42161 },
      idempotencyKey: "mm-project-held" });
    assert.equal(held.ok, false); assert.equal(held.error?.details?.reason, "mm_gasless_project_has_no_wallets");
    assert.equal(held.error?.details?.blockingOperationId, id);
    assert.equal(held.next_actions[0], `apn operation status --operation ${id}`);
    assert.match(held.next_actions[1]!, new RegExp(`^Wallet connect for this profile waits until operation ${id} is terminal\\.`, "u"));
    assert.deepEqual(held.next_actions.slice(2), await expectedActions("none", 1));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("approve whose guard finds the bound wallet outside the login's project ends before effect and names both ways forward", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-project-wallets-"));
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    const refusal = await clientQuoteError(exchangeAnswering(answer(200, { wallets: [{ address: OTHER_A }] })), f.binding.revision);
    f.provider.quote = async () => { throw refusal; };
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const shown = approved.operation as Record<string, unknown>;
    assert.deepEqual([shown.state, shown.reason], ["failed_before_effect", "mm_gasless_wallet_not_in_project"]);
    assert.deepEqual(shown.next_actions, [...await expectedActions("others", 1, "the other EVM server wallets"), `apn receipt get --operation ${id}`]);
    assert.equal(JSON.stringify(approved).includes(OTHER_A), false);
    assert.equal(f.provider.submissions.length, 0, "nothing was dispatched");
    assert.deepEqual([(await f.record(id)).state, (await f.record(id)).submissionAttempts], ["failed_before_effect", 0]);
    assert.equal(f.wait.waits.length, 0, "a definite refusal is not waited out");
  } finally { await rm(root, { recursive: true, force: true }); }
});
