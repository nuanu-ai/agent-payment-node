import assert from "node:assert/strict";
import { readFile, rename, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { executeHelperRequest, MetaMaskGaslessProviderClient, MM_HELPER_VERSION,
  SubprocessMetaMaskGaslessHelperRunner, type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import type { MetaMaskGaslessProfileIdentity, MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { MM_CHAINS } from "../../src/metamask-gasless/registry.js";
import { expectedQuote, intent, NOW, OWNER, PROJECT, quoteInput, SECRET, SdkExchange, syntheticHome } from
  "./metamask-gasless-client-fixtures/sdk.js";

function identity(binding: Awaited<ReturnType<typeof syntheticHome>>["binding"]): MetaMaskGaslessProfileIdentity {
  return { profile: "fixture", profileHash: "e".repeat(64), address: binding.address,
    accountBindingHash: binding.accountBindingHash, capabilityHash: binding.capabilityHash, revision: binding.revision };
}

test("client inspect hydrates official managers and resolves exact address/name while preserving unrelated records", async (t) => {
  const addressHome = await syntheticHome({ byokWallets: [{ id: "byok:evm:0", address: OWNER, namespace: "evm", index: 0,
    derivationPath: "m/44'/60'/0'/0/0" }], remoteWallets: [{ address: "solana-address", name: "sol", namespace: "solana" },
      { address: OWNER, namespace: "evm" }] }); t.after(addressHome.cleanup);
  const inspected = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(addressHome.binding) },
    { homeDirectory: addressHome.home, now: () => NOW });
  assert.deepEqual(inspected, { version: MM_HELPER_VERSION, ok: true, result: addressHome.binding });
  assert.equal(JSON.stringify(inspected).includes(SECRET), false);

  const nameHome = await syntheticHome({ ref: { name: "primary" } }); t.after(nameHome.cleanup);
  const named = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(nameHome.binding) },
    { homeDirectory: nameHome.home, now: () => NOW });
  assert.equal(named.ok, true); if (named.ok) assert.deepEqual(named.result, nameHome.binding);
  assert.equal(await readFile(join(nameHome.directory, "session.json"), "utf8"), nameHome.sessionBytes);
  assert.equal(await readFile(join(nameHome.directory, "wallets.json"), "utf8"), nameHome.walletBytes);
});

test("client inspect rejects id fallback, duplicate selected matches, unsafe files, and stale JWT without private output", async (t) => {
  const idHome = await syntheticHome({ ref: { id: "incidental-id" } }); t.after(idHome.cleanup);
  const idResult = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(idHome.binding) },
    { homeDirectory: idHome.home, now: () => NOW });
  assert.deepEqual(idResult, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROFILE_DRIFT", reason: "mm_gasless_identity" } });

  const duplicate = await syntheticHome({ ref: { name: "primary" }, remoteWallets: [{ address: OWNER, name: "primary", namespace: "evm" },
    { address: "0x4444444444444444444444444444444444444444", name: "primary", namespace: "evm" }] }); t.after(duplicate.cleanup);
  const duplicateResult = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(duplicate.binding) },
    { homeDirectory: duplicate.home, now: () => NOW });
  assert.equal(duplicateResult.ok, false);

  const stale = await syntheticHome({ exp: Math.floor(NOW.getTime() / 1000) }); t.after(stale.cleanup);
  const staleResult = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(stale.binding) },
    { homeDirectory: stale.home, now: () => NOW });
  assert.deepEqual(staleResult, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_unavailable" } });

  const linked = await syntheticHome(); t.after(linked.cleanup);
  const original = join(linked.directory, "wallets-original.json"); await rename(join(linked.directory, "wallets.json"), original);
  await symlink(original, join(linked.directory, "wallets.json"));
  const linkedResult = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(linked.binding) },
    { homeDirectory: linked.home, now: () => NOW });
  assert.deepEqual(linkedResult, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_STATE_SECURITY", reason: "mm_gasless_state_security" } });

  const carrier = await syntheticHome(); t.after(carrier.cleanup);
  await symlink(dirname(linked.home), join(carrier.home, "linked-parent"));
  const ancestorResult = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(linked.binding) },
    { homeDirectory: join(carrier.home, "linked-parent", basename(linked.home)), now: () => NOW });
  assert.deepEqual(ancestorResult, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_STATE_SECURITY", reason: "mm_gasless_state_security" } });
  assert.equal(JSON.stringify([idResult, staleResult, linkedResult, ancestorResult]).includes(SECRET), false);
});

test("client buildUnsigned runs public prepareDelegation defaults and root verifier on all eight chains with no network", async () => {
  for (const chainId of MM_CHAINS) {
    const quote = expectedQuote(chainId), exchange = new SdkExchange(chainId);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
      input: { owner: OWNER, chainId, executions: quote.executions } }, { now: () => NOW, exchange });
    assert.equal(result.ok, true, `chain ${chainId}`); assert.equal(exchange.requests.length, 0);
    if (result.ok) {
      const unsigned = result.result as MetaMaskGaslessUnsignedResult;
      assert.equal(unsigned.relayTo.length, 42); assert.equal(unsigned.unsignedDelegation.caveats.length, 2);
      assert.notEqual(unsigned.delegationHash, unsigned.signingDigest);
    }
  }
});

test("client quote runs actual public factory and exact finite network budget on all eight chains", async (t) => {
  for (const chainId of MM_CHAINS) {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(chainId);
    const input = quoteInput(home.binding, chainId), result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(result.ok, true, `chain ${chainId}: ${JSON.stringify(result)}`);
    if (result.ok) assert.deepEqual(result.result, expectedQuote(chainId));
    assert.equal(exchange.requests.length, 6);
    assert.equal(exchange.requests.filter((request) => request.url === input.rpcUrl).length, 2);
    assert.equal(exchange.requests.filter((request) => request.headers.authorization === `Bearer ${home.token}`).length, 2);
    assert.ok(exchange.requests.filter((request) => request.url === input.rpcUrl).every((request) => request.headers.authorization === undefined));
    assert.equal(await readFile(join(home.directory, "session.json"), "utf8"), home.sessionBytes);
    assert.equal(await readFile(join(home.directory, "wallets.json"), "utf8"), home.walletBytes);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  assert.equal(Object.hasOwn(globalThis, "window"), false);
});

test("client denies incomplete inventory success instead of using public fallback flags", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453, 200, "inventory");
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
  assert.equal(exchange.requests.filter((request) => request.url.includes("rpc.example.test")).length, 0);
});

test("client uses one public server adapter POST and one independent GET, with full frozen wire and late observation", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const chainId = 8453;
  const unsignedResponse = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId, executions: expectedQuote(chainId).executions } }, { now: () => NOW, exchange: new SdkExchange(chainId) });
  assert.equal(unsignedResponse.ok, true); if (!unsignedResponse.ok) return;
  const operation = intent(home.binding, chainId, expectedQuote(chainId), unsignedResponse.result as MetaMaskGaslessUnsignedResult);

  const submitExchange = new SdkExchange(chainId);
  const submitted = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange: submitExchange });
  assert.equal(submitted.ok, true); if (submitted.ok) assert.equal((submitted.result as { status: string }).status, "pending");
  assert.equal(submitExchange.requests.length, 1); assert.equal(submitExchange.beforeSends, 1);
  const post = JSON.parse(submitExchange.requests[0]!.body!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(post).sort(), ["delegation", "encoding", "executions", "method", "requestId", "tx"]);
  assert.equal(JSON.stringify(post).includes("signature"), false); assert.equal(JSON.stringify(post).includes("authorizationList"), false);
  assert.equal(JSON.stringify(post).includes(SECRET), false);

  const expired = { ...operation, expiresAt: new Date(NOW.getTime() - 1).toISOString() };
  const observeExchange = new SdkExchange(chainId);
  const observed = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "observe", intent: expired },
    { homeDirectory: home.home, now: () => new Date(NOW.getTime() + 600_000), exchange: observeExchange });
  assert.equal(observed.ok, true); if (observed.ok) {
    const result = observed.result as { status: string; txHash: string }; assert.equal(result.status, "confirmed");
    assert.equal(result.txHash, `0x${"44".repeat(32)}`);
  }
  assert.equal(observeExchange.requests.length, 1); assert.equal(observeExchange.requests[0]!.method, "GET");
});

test("client rechecks observable submit deadline after private hydration and immediately before POST", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const chainId = 8453, quote = expectedQuote(chainId);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId, executions: quote.executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult);
  let calls = 0; const exchange = new SdkExchange(chainId);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation }, { homeDirectory: home.home,
    now: () => ++calls < 5 ? NOW : new Date(operation.expiresAt), exchange });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.failure.reason, "mm_gasless_expired");
  assert.equal(exchange.requests.length, 1); assert.equal(exchange.beforeSends, 0);
});

test("client rejects malformed job identity after one request and emits only closed failures", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const chainId = 8453, quote = expectedQuote(chainId);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId, executions: quote.executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult), exchange = new SdkExchange(chainId, 200, "job");
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_OPERATION_BLOCKED", reason: "mm_gasless_submit_unknown" } });
  assert.equal(exchange.requests.length, 1); assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("client preserves fixed auth failures without retry and maps one 404 observation to unavailable", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const chainId = 8453, quote = expectedQuote(chainId);
  const quoteAuth = new SdkExchange(chainId, 401);
  const deniedQuote = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, chainId) },
    { homeDirectory: home.home, now: () => NOW, exchange: quoteAuth });
  assert.deepEqual(deniedQuote, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_unavailable" } });
  assert.ok(quoteAuth.requests.length <= 3); assert.equal(quoteAuth.requests.some((request) => request.url.includes("rpc.example.test")), false);

  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId, executions: quote.executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult);
  const submitAuth = new SdkExchange(chainId, 401);
  const deniedSubmit = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange: submitAuth });
  assert.deepEqual(deniedSubmit, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_SESSION_REQUIRED", reason: "mm_gasless_session_unavailable" } });
  assert.equal(submitAuth.requests.length, 1);

  const missing = new SdkExchange(chainId, 404);
  const observed = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "observe", intent: operation },
    { homeDirectory: home.home, now: () => NOW, exchange: missing });
  assert.equal(observed.ok, true); if (observed.ok) assert.equal((observed.result as { status: string }).status, "unavailable");
  assert.equal(missing.requests.length, 1);
});

test("actual quote controller failure restores the Node global and leaves no timer resource", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const before = process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
  const exchange = new SdkExchange(8453, 200, "quote");
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(result.ok, false); assert.equal(Object.hasOwn(globalThis, "window"), false);
  assert.equal(process.getActiveResourcesInfo().filter((name) => name === "Timeout").length, before);
});

test("parent client enforces pre-submit expiry and bounded runner protocol", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const chainId = 8453, quote = expectedQuote(chainId);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId, executions: quote.executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const expired = { ...intent(home.binding, chainId, quote, built.result as MetaMaskGaslessUnsignedResult), expiresAt: NOW.toISOString() };
  let calls = 0; const runner: MetaMaskGaslessHelperRunner = { async run(request) { calls += 1; return executeHelperRequest(request,
    { homeDirectory: home.home, now: () => NOW, exchange: new SdkExchange(chainId) }); } };
  const client = new MetaMaskGaslessProviderClient({ environment: { HOME: home.home }, clock: { now: () => NOW }, runner });
  await assert.rejects(client.submit(expired), { code: "APN_REPREPARE_REQUIRED" }); assert.equal(calls, 0);
  assert.deepEqual(await client.inspect(identity(home.binding)), home.binding); assert.equal(calls, 1);

  const processRunner = new SubprocessMetaMaskGaslessHelperRunner();
  const raw = await processRunner.run({ version: MM_HELPER_VERSION, mode: "inspect", expected: identity(home.binding) },
    { environment: { HOME: home.home, NODE_OPTIONS: "--definitely-invalid-option" }, timeoutMs: 60_000 });
  assert.deepEqual(raw, { version: MM_HELPER_VERSION, ok: true, result: home.binding });
});

test("helper refuses a DOM-bearing process before public SDK construction", async () => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  try {
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
      input: { owner: OWNER, chainId: 1, executions: expectedQuote(1).executions } }, { now: () => NOW });
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_STATE_SECURITY", reason: "mm_gasless_state_security" } });
  } finally { Reflect.deleteProperty(globalThis, "document"); }
});
