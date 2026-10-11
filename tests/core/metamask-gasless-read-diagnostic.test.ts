import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { executeHelperRequest } from "../../src/metamask-gasless/client/service.js";
import { MetaMaskGaslessProviderClient, SubprocessMetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/process.js";
import { helperResponse, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/protocol.js";
import { HelperNetworkPolicy, networkContextQuote } from "../../src/metamask-gasless/client/network.js";
import { readDiagnostic, readRunnerFailure, validateReadDiagnostic } from "../../src/metamask-gasless/client/read-diagnostic.js";
import { expectedQuote, NOW, quoteInput, SECRET, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

const failure = { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } as const;
const request = { version: MM_HELPER_VERSION, mode: "inspect" as const, expected: { profile: "fixture",
  profileHash: "e".repeat(64), address: "0x1111111111111111111111111111111111111111" as const,
  accountBindingHash: "a".repeat(64), capabilityHash: "b".repeat(64), revision: 1 } };
const d = readDiagnostic("inspect", "hydrate", "unclassified_exception");

test("read diagnostics accept exact closed data and preserve legacy failed envelope", () => {
  const old = { version: MM_HELPER_VERSION, ok: false, failure };
  assert.deepEqual(helperResponse(old, request), old);
  assert.deepEqual(helperResponse({ ...old, diagnostic: d }, request), { ...old, diagnostic: d });
  assert.equal(Object.isFrozen(validateReadDiagnostic(d, "inspect")), true);
});

test("untrusted diagnostic keys, values, proxies and getters fail closed without evaluating secrets", async (t) => {
  let touched = 0;
  const cases: unknown[] = [
    { ...d, rawError: SECRET }, { ...d, mode: "submit" }, { ...d, stage: SECRET },
    { ...d, invariant: SECRET }, { ...d, network: "sentinel-quote" }, { ...d, httpStatus: 99 },
    { ...d, exitCode: 256 }, { ...d, exitCode: 1 }, { ...d, signal: SECRET }, { ...d, timedOut: "false" },
    { ...d, stage: "fee_quote" }, { ...d, timedOut: true },
    { ...d, stage: { toString() { touched++; return "hydrate"; } } },
    new Proxy(d, { get() { touched++; throw new Error(SECRET); } }),
    Object.defineProperty({ ...d }, "stage", { enumerable: true, get() { touched++; throw new Error(SECRET); } }),
  ];
  for (const [index, diagnostic] of cases.entries()) await t.test(String(index), () => {
    assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: false, failure, diagnostic }, request),
      (e: unknown) => e instanceof ApnError && e.code === failure.code && !JSON.stringify(e).includes(SECRET));
  });
  assert.equal(touched, 0);
});

test("diagnostic cannot decorate a successful or financial helper response", () => {
  assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: true, result: {}, diagnostic: d }, request));
  const build = { version: MM_HELPER_VERSION, mode: "buildUnsigned" as const,
    input: { owner: request.expected.address, chainId: 8453 as const, executions: expectedQuote(8453).executions } };
  assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: false, failure, diagnostic: d }, build));
});

test("parent emits only validated primitive diagnostics and retains original failure identity", async () => {
  const client = new MetaMaskGaslessProviderClient({ runner: { async run() {
    return { version: MM_HELPER_VERSION, ok: false, failure, diagnostic: d };
  } } });
  await assert.rejects(client.inspect(request.expected), (e: unknown) => {
    assert.ok(e instanceof ApnError); assert.equal(e.code, failure.code); assert.equal(e.details?.reason, failure.reason);
    assert.equal(e.details?.mm_read_mode, "inspect"); assert.equal(e.details?.mm_read_stage, "hydrate");
    assert.equal(e.details?.mm_read_invariant, "unclassified_exception");
    assert.equal(JSON.stringify(e).includes(SECRET), false); return true;
  });
});

test("untrusted runner errors expose no arbitrary message and trusted timeout retains fixed metadata", async () => {
  for (const trusted of [false, true]) {
    const client = new MetaMaskGaslessProviderClient({ runner: { async run() {
      throw trusted ? readRunnerFailure("inspect", "runner_timeout") : new Error(`${SECRET} Authorization: Bearer secret https://x/?key=private`);
    } } });
    await assert.rejects(client.inspect(request.expected), (e: unknown) => {
      assert.ok(e instanceof ApnError); assert.equal(e.code, failure.code);
      assert.equal(e.details?.mm_read_invariant, trusted ? "runner_timeout" : "runner_launch");
      assert.equal(e.details?.mm_read_timed_out, trusted); assert.equal(JSON.stringify(e).includes(SECRET), false); return true;
    });
  }
});

test("normal inspect failure before any HTTP has private-state diagnostic and no cache mutation", async (t) => {
  const home = await syntheticHome({ exp: Math.floor(NOW.getTime() / 1000) }); t.after(home.cleanup);
  const exchange = new SdkExchange(8453);
  const expected = { ...request.expected, address: home.binding.address,
    accountBindingHash: home.binding.accountBindingHash, capabilityHash: home.binding.capabilityHash, revision: home.binding.revision };
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(result.ok, false); if (result.ok) return;
  assert.deepEqual(result.failure, { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_unavailable" });
  assert.equal(result.diagnostic?.mode, "inspect"); assert.equal(result.diagnostic?.stage, "private_state");
  assert.equal(result.diagnostic?.network, "none"); assert.equal(result.diagnostic?.httpStatus, null);
  assert.deepEqual(exchange.requests, []);
});

test("normal quote HTTP failure identifies quote inventory phase without leaking exchange error", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); let calls = 0;
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange: { async request() { calls++; throw new Error(SECRET); } } });
  assert.equal(result.ok, false); if (result.ok) return;
  assert.equal(result.failure.code, failure.code); assert.equal(result.diagnostic?.mode, "quote");
  assert.equal(result.diagnostic?.stage, "inventory"); assert.ok(calls >= 1 && calls <= 3);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("concurrent policy reads associate fixed HTTP status with the actual thrown error", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const input = quoteInput(home.binding, 8453);
  const policy = new HelperNetworkPolicy(networkContextQuote(input, home.binding.address, SECRET), { async request(r) {
    if (r.url.includes("mimir")) return { status: 200, body: JSON.stringify({ malformed: SECRET }) };
    return { status: 200, body: JSON.stringify({ fullSupport: [], partialSupport: {} }) };
  } });
  let caught: unknown;
  await Promise.all([
    policy.fetch("https://agentic-mimir-service.api.cx.metamask.io/v1/supportedNetworks").catch(e => { caught = e; }),
    policy.fetch("https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts/v2/supportedNetworks"),
  ]);
  assert.ok(caught instanceof ApnError);
  assert.deepEqual(policy.readFailureContext(caught), { network: "mimir-networks", httpStatus: 200, validationFailed: true });
  assert.deepEqual(policy.readFailureContext(new Error(SECRET)), { network: "none", httpStatus: null, validationFailed: false });
});

test("normal successful inspect and quote retain exact old envelopes and no diagnostic", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const expected = { ...request.expected, address: home.binding.address,
    accountBindingHash: home.binding.accountBindingHash, capabilityHash: home.binding.capabilityHash, revision: home.binding.revision };
  const inspected = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected },
    { homeDirectory: home.home, now: () => NOW });
  assert.deepEqual(inspected, { version: MM_HELPER_VERSION, ok: true, result: home.binding });
  const quoted = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange: new SdkExchange(8453) });
  assert.deepEqual(quoted, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(8453) });
});

test("real normal subprocess preserves closed inspect failure with isolated expired TEST state", async (t) => {
  const home = await syntheticHome({ exp: 1 }); t.after(home.cleanup);
  const expected = { ...request.expected, address: home.binding.address,
    accountBindingHash: home.binding.accountBindingHash, capabilityHash: home.binding.capabilityHash, revision: home.binding.revision };
  const client = new MetaMaskGaslessProviderClient({ environment: { HOME: home.home } });
  await assert.rejects(client.inspect(expected), (e: unknown) => {
    assert.ok(e instanceof ApnError); assert.equal(e.code, "APN_PROVIDER_SESSION_REQUIRED");
    assert.equal(e.details?.mm_read_mode, "inspect"); assert.equal(e.details?.mm_read_stage, "private_state");
    assert.equal(e.details?.mm_read_network, "none"); assert.equal(JSON.stringify(e).includes(SECRET), false); return true;
  });
});

test("real launcher validation failure occurs before a child and exposes fixed launch diagnostic", async () => {
  const runner = new SubprocessMetaMaskGaslessHelperRunner();
  const client = new MetaMaskGaslessProviderClient({ runner: { async run(r) {
    return await runner.run(r, { environment: {}, timeoutMs: 0 });
  } } });
  await assert.rejects(client.inspect(request.expected), (e: unknown) => {
    assert.ok(e instanceof ApnError); assert.equal(e.code, failure.code);
    assert.equal(e.details?.mm_read_stage, "launch"); assert.equal(e.details?.mm_read_invariant, "runner_launch");
    return true;
  });
});


test("normal malformed 2xx parser and schema failures carry trusted validation boundary", async (t) => {
  for (const body of ["{", JSON.stringify({ unexpected: SECRET })]) await t.test(body === "{" ? "parser" : "schema", async (t) => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange: { async request(r) {
        return r.url.includes("mimir") ? { status: 200, body } : await exchange.request(r);
      } } });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.failure.code, "APN_PROVIDER_UNAVAILABLE");
    assert.equal(result.failure.reason, "mm_gasless_provider_unavailable");
    assert.deepEqual(result.diagnostic, { mode: "quote", stage: "inventory", invariant: "network_validation",
      network: "mimir-networks", httpStatus: 200, exitCode: null, signal: "none", timedOut: false });
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  });
});

test("HTTP authentication and unbound errors cannot manufacture network validation provenance", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange: new SdkExchange(8453, 401) });
  assert.equal(result.ok, false); if (result.ok) return;
  assert.deepEqual(result.diagnostic, { mode: "quote", stage: "inventory", invariant: "closed_failure",
    network: "mimir-networks", httpStatus: 401, exitCode: null, signal: "none", timedOut: false });
  const policy = new HelperNetworkPolicy(networkContextQuote(quoteInput(home.binding, 8453), home.binding.address, SECRET),
    { async request() { return { status: 500, body: "{" }; } });
  const response = await policy.fetch("https://agentic-mimir-service.api.cx.metamask.io/v1/supportedNetworks");
  assert.equal(response.status, 500);
  assert.deepEqual(policy.readFailureContext(new Error(SECRET)), { network: "none", httpStatus: null, validationFailed: false });
});
