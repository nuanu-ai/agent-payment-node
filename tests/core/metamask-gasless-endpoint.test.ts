import assert from "node:assert/strict";
import test from "node:test";
import { HelperNetworkPolicy, networkContextQuote, type FetchExchange, type FetchExchangeRequest } from
  "../../src/metamask-gasless/client/network.js";
import type { MetaMaskGaslessQuoteInput } from "../../src/metamask-gasless/ports.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = mmRegistry(8453).row.token;
const ROOT = "https://mainnet.base.org";
const rejected = { code: "APN_PROVIDER_UNAVAILABLE" };

function policy(rpcUrl = ROOT) {
  const requests: FetchExchangeRequest[] = [];
  const exchange: FetchExchange = { async request(request) {
    requests.push(request);
    const id = (JSON.parse(request.body!) as { id: number }).id;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: `0x${"6".padStart(64, "0")}` }) };
  } };
  const input: MetaMaskGaslessQuoteInput = { binding: { providerId: "metamask-agent-wallet", address: OWNER,
    accountBindingHash: "1".repeat(64), capabilityHash: "2".repeat(64), revision: 1, projectHash: "3".repeat(64),
    walletReferenceHash: "4".repeat(64), walletIdHash: "5".repeat(64), namespace: "eip155", mode: "server", environment: "prod" },
    chainId: 8453, token: TOKEN, recipient: "0x2222222222222222222222222222222222222222", netAtomic: "1000", rpcUrl };
  return { gate: new HelperNetworkPolicy(networkContextQuote(input, OWNER, "unit-test-auth"), exchange), requests };
}
function body(call: Record<string, unknown> = { to: TOKEN, data: "0x313ce567" }, tag: unknown = "latest") {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [call, tag] });
}
function post(gate: HelperNetworkPolicy, url: string, requestBody = body(), method = "POST", headers: Record<string, string> = {}) {
  return gate.fetch(url, { method, headers: { accept: "application/json", "content-type": "application/json", ...headers }, body: requestBody });
}

test("SDK URL.href root-slash normalization admits the original Base USDC decimals request", async () => {
  const { gate, requests } = policy();
  assert.equal((await post(gate, new URL(ROOT).href)).status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, `${ROOT}/`);
  assert.deepEqual(JSON.parse(requests[0]!.body!), { jsonrpc: "2.0", id: 1, method: "eth_call",
    params: [{ to: TOKEN, data: "0x313ce567" }, "latest"] });
});

test("root-slash and default HTTPS port aliases remain endpoint-bound in either direction", async () => {
  for (const [bound, request] of [[ROOT, `${ROOT}/`], [`${ROOT}/`, ROOT], [ROOT, "https://mainnet.base.org:443/"],
    ["https://mainnet.base.org:443", `${ROOT}/`]]) {
    const { gate, requests } = policy(bound);
    assert.equal((await post(gate, request!)).status, 200);
    assert.equal(requests.length, 1);
  }
  const exactPath = policy(`${ROOT}/bound-rpc`);
  assert.equal((await post(exactPath.gate, `${ROOT}/bound-rpc`)).status, 200);
  assert.equal(exactPath.requests.length, 1, "preserve previously bound exact RPC paths");
});

test("unbound host, scheme, port, path, credentials, query and fragment fail before exchange", async () => {
  for (const url of ["https://unbound.example/", "http://mainnet.base.org/", "https://mainnet.base.org:8443/",
    `${ROOT}/unbound-rpc`, `${ROOT}/a/..`, `${ROOT}/%2e`, `${ROOT}//`, `${ROOT}?x=1`, `${ROOT}?`, `${ROOT}#x`, `${ROOT}#`,
    "https://user:password@mainnet.base.org/", "https://@mainnet.base.org/", "https://mainnet.base.org\\unbound"]) {
    const { gate, requests } = policy();
    await assert.rejects(post(gate, url), rejected, url);
    assert.equal(requests.length, 0, "reject before DNS and physical transport");
  }
  for (const bound of [`${ROOT}#x`, "https://user@mainnet.base.org/", "http://mainnet.base.org/"]) {
    const { gate, requests } = policy(bound);
    await assert.rejects(post(gate, bound), { code: "APN_RPC_CONFIG" });
    assert.equal(requests.length, 0);
  }
});

test("normalization fallback rejects backslashes and raw ASCII control or whitespace spellings", async () => {
  const backslash = String.fromCharCode(92);
  const backslashes = [ROOT + backslash, ROOT + backslash + "/", ROOT + "/" + backslash,
    ROOT + backslash + "unbound", "https:" + backslash + backslash + "mainnet.base.org"];
  const controls = Array.from({ length: 33 }, (_, index) => String.fromCharCode(index));
  controls.push(String.fromCharCode(127));
  const controlUrls = controls.flatMap((character) => [`${character}${ROOT}`, `${ROOT}${character}`, `${ROOT}/${character}`]);
  controlUrls.push(...[9, 10, 13].map((code) => `https://main${String.fromCharCode(code)}net.base.org/`));
  for (const url of [...backslashes, ...controlUrls]) {
    const { gate, requests } = policy();
    await assert.rejects(post(gate, url), rejected, JSON.stringify(url));
    assert.equal(requests.length, 0, "new fallback rejection must precede DNS and exchange");
  }
  for (const bound of [`${ROOT}/a/..`, `${ROOT}#`]) {
    const { gate, requests } = policy(bound);
    assert.equal((await post(gate, bound)).status, 200, "retain validated original raw exact compatibility");
    assert.equal(requests.length, 1);
  }
});

test("existing configured API-key queries remain exact-bound without normalization aliases", async () => {
  const bound = `${ROOT}/8453?api-key=synthetic`;
  const exact = policy(bound);
  assert.equal((await post(exact.gate, bound)).status, 200);
  assert.equal(exact.requests.length, 1);
  for (const alias of [`${ROOT}/8453?api-key=different`, `${ROOT}/8453?api-key=synthetic&extra=1`,
    `${ROOT}:443/8453?api-key=synthetic`, `${ROOT}/8453/?api-key=synthetic`]) {
    const { gate, requests } = policy(bound);
    await assert.rejects(post(gate, alias), rejected);
    assert.equal(requests.length, 0);
  }
});

test("normalized RPC aliases share the original once-only decimals and balance keys", async () => {
  for (const [first, second] of [[ROOT, `${ROOT}/`], [`${ROOT}/`, ROOT], [ROOT, "https://mainnet.base.org:443/"]]) {
    const { gate, requests } = policy();
    await post(gate, first!);
    await assert.rejects(post(gate, second!), rejected);
    assert.equal(requests.length, 1);
  }
  const { gate, requests } = policy();
  const balance = body({ to: TOKEN, data: `0x70a08231${OWNER.slice(2).padStart(64, "0")}` }, "pending");
  await post(gate, ROOT, balance);
  await assert.rejects(post(gate, `${ROOT}/`, balance), rejected);
  assert.equal(requests.length, 1);
});

test("normalized equality preserves exact readonly RPC, body, token and owner constraints", async () => {
  const valid = JSON.parse(body()) as Record<string, unknown>;
  const invalidBodies = [JSON.stringify({ ...valid, method: "eth_sendRawTransaction" }), JSON.stringify({ ...valid, method: "eth_chainId" }),
    JSON.stringify({ ...valid, chainId: 8453 }), JSON.stringify({ ...valid, jsonrpc: "1.0" }), JSON.stringify({ ...valid, params: [] }),
    body({ to: OWNER, data: "0x313ce567" }), body({ to: TOKEN, data: "0x313ce567", from: OWNER }),
    body({ to: TOKEN, data: "0x095ea7b3" }), body({ to: TOKEN, data: "0x313ce56700" }), body(undefined, "safe"),
    body({ to: TOKEN, data: `0x70a08231${"2".repeat(64)}` }), body({ to: TOKEN, data: "0x70a08231" })];
  for (const requestBody of invalidBodies) {
    const { gate, requests } = policy();
    await assert.rejects(post(gate, `${ROOT}/`, requestBody), rejected);
    assert.equal(requests.length, 0);
  }
  for (const method of ["PUT", "DELETE"]) {
    const { gate, requests } = policy();
    await assert.rejects(post(gate, `${ROOT}/`, body(), method), rejected);
    assert.equal(requests.length, 0);
  }
  const bearer = policy();
  await assert.rejects(post(bearer.gate, `${ROOT}/`, body(), "POST", { authorization: "Bearer unit-test-auth" }), rejected);
  assert.equal(bearer.requests.length, 0);
});

// The real pinned SDK consumes the last transaction, low tier0, explicit requested token.
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { NOW, quoteInput, SdkExchange, syntheticHome, SECRET } from "./metamask-gasless-client-fixtures/sdk.js";
import { metaMaskGaslessQuote } from "../../src/metamask-gasless/quotation.js";
import { MetaMaskGaslessClock } from "../../src/metamask-gasless/clock.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { encodeFunctionData, parseAbi } from "viem";
import type { MetaMaskGaslessProviderPort } from "../../src/metamask-gasless/ports.js";

type SentinelMutation = (value: ReturnType<typeof JSON.parse>) => void;
class SelectedTierExchange extends SdkExchange {
  constructor(readonly mutate: SentinelMutation) { super(8453); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
    const value = JSON.parse(response.body);
    this.mutate(value);
    return { ...response, body: JSON.stringify(value) };
  }
}
function observedShape(value: ReturnType<typeof JSON.parse>) {
  const entry = value.result.transactions[0].fees[0].tokenFees[0];
  value.result.transactions = [{ fees: [
    { tokenFees: [{ ...entry, balanceNeededToken: "0x1483", error: "" }] },
    { tokenFees: [{ ...entry, balanceNeededToken: "0x169e", error: "" }] },
    { tokenFees: [{ ...entry, balanceNeededToken: "0x18fa", error: "" }] },
    { error: SECRET },
  ] }];
}
async function syntheticSelectedQuote(t: { after(fn: () => Promise<void>): void }, mutate: SentinelMutation) {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = new SelectedTierExchange(mutate);
  const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(JSON.stringify(response).includes(SECRET), false);
  assert.equal(exchange.requests.some((request) => request.url.includes("transaction-requests")), false);
  return { response, exchange };
}

test("observed valid LOW tier with an unused fourth tier lacking tokenFees passes the gate and real SDK", async (t) => {
  const { response, exchange } = await syntheticSelectedQuote(t, observedShape);
  assert.equal(response.ok, true);
  if (response.ok) assert.equal((response.result as { feeAtomic: string }).feeAtomic, "5251");
  assert.equal(exchange.requests.length, 6);
  assert.equal(exchange.beforeSends, 0);
});

test("earlier transaction and higher fee tiers cannot replace the exact last LOW selection", async (t) => {
  const cases: [string, SentinelMutation][] = [
    ["earlier valid last missing", v => { const good = v.result.transactions[0]; v.result.transactions = [good, { fees: [{}] }]; }],
    ["LOW missing HIGH valid", v => { const good = v.result.transactions[0].fees[0]; v.result.transactions[0].fees = [{}, good]; }],
    ["LOW token absent HIGH matching", v => { const good = structuredClone(v.result.transactions[0].fees[0]); v.result.transactions[0].fees[0].tokenFees[0].token.address = OWNER; v.result.transactions[0].fees.push(good); }],
    ["last transaction missing", v => { v.result.transactions.push(null); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async sub => {
    const { response, exchange } = await syntheticSelectedQuote(sub, mutate);
    assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
    assert.equal(exchange.requests.length, 5);
  });
  const good = await syntheticSelectedQuote(t, v => { observedShape(v); v.result.transactions.unshift({ fees: [{}], unused: SECRET }); });
  assert.equal(good.response.ok, true);
});

test("selected requested-token fee entry retains required fields and rejects ambiguity or provider errors", async (t) => {
  const cases: [string, SentinelMutation][] = [
    ["duplicate requested token", v => { const a = v.result.transactions[0].fees[0].tokenFees; a.push(structuredClone(a[0])); }],
    ["truthy selected error", v => { v.result.transactions[0].fees[0].tokenFees[0].error = SECRET; }],
    ["missing token", v => { delete v.result.transactions[0].fees[0].tokenFees[0].token; }],
    ["missing address", v => { delete v.result.transactions[0].fees[0].tokenFees[0].token.address; }],
    ["malformed candidate address before matching", v => { v.result.transactions[0].fees[0].tokenFees.unshift({ token: { address: "wrong" } }); }],
    ["wrong decimals", v => { v.result.transactions[0].fees[0].tokenFees[0].token.decimals = 5; }],
    ["missing symbol", v => { delete v.result.transactions[0].fees[0].tokenFees[0].token.symbol; }],
    ["empty symbol", v => { v.result.transactions[0].fees[0].tokenFees[0].token.symbol = ""; }],
    ["oversize symbol", v => { v.result.transactions[0].fees[0].tokenFees[0].token.symbol = "s".repeat(33); }],
    ["missing quantity", v => { delete v.result.transactions[0].fees[0].tokenFees[0].balanceNeededToken; }],
    ["noncanonical quantity", v => { v.result.transactions[0].fees[0].tokenFees[0].balanceNeededToken = "0x00"; }],
    ["missing fee recipient", v => { delete v.result.transactions[0].fees[0].tokenFees[0].feeRecipient; }],
    ["malformed fee recipient", v => { v.result.transactions[0].fees[0].tokenFees[0].feeRecipient = "wrong"; }],
    ["empty transactions", v => { v.result.transactions = []; }],
    ["transactions bound", v => { v.result.transactions = Array(9).fill(v.result.transactions[0]); }],
    ["fee tier bound", v => { v.result.transactions[0].fees = Array(9).fill(v.result.transactions[0].fees[0]); }],
    ["token bound", v => { v.result.transactions[0].fees[0].tokenFees = Array(33).fill(v.result.transactions[0].fees[0].tokenFees[0]); }],
    ["wrong envelope id", v => { v.id = 11; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async sub => {
    const { response, exchange } = await syntheticSelectedQuote(sub, mutate);
    assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
    assert.equal(exchange.requests.length, 5);
  });
});

test("existing economic loop uses at most three quotes and converges the observed 5248 to 5251 fee movement", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const input = quoteInput(home.binding, 8453), requested: string[] = [];
  const recipient = input.recipient, feeRecipient = "0x3333333333333333333333333333333333333333";
  const abi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
  const provider = { async quote(q: typeof input) {
    requested.push(q.netAtomic); const fee = requested.length === 1 ? "5248" : "5251";
    const executions = [recipient, feeRecipient].map((to, i) => ({ target: TOKEN, value: "0" as const,
      callData: encodeFunctionData({ abi, functionName: "transfer", args: [to as `0x${string}`, BigInt(i === 0 ? q.netAtomic : fee)] }) }));
    const material = { netAtomic: q.netAtomic, feeAtomic: fee, feeRecipient: feeRecipient as `0x${string}`,
      executions: executions as unknown as readonly [typeof executions[number], typeof executions[number]] };
    return { ...material, hash: mmQuoteHash(material) };
  } } as unknown as MetaMaskGaslessProviderPort;
  const quote = await metaMaskGaslessQuote(provider, home.binding,
    { chainId: 8453, recipient, grossAtomic: "80000", maxFeeAtomic: "79000", minReceivedAtomic: "1000" }, ROOT,
    new MetaMaskGaslessClock({ now: () => NOW }));
  assert.deepEqual(requested, ["1000", "74752", "74749"]);
  assert.equal(quote.feeAtomic, "5251"); assert.equal(BigInt(quote.netAtomic) + BigInt(quote.feeAtomic), 80000n);
  assert(BigInt(quote.feeAtomic) <= 79000n && BigInt(quote.netAtomic) >= 1000n);
});

test("unsigned delegation construction remains offchain with no provider or RPC exchange", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
  const quote = (await import("./metamask-gasless-client-fixtures/sdk.js")).expectedQuote(8453);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: home.binding.address, chainId: 8453, executions: quote.executions } }, { now: () => NOW, exchange });
  assert.equal(result.ok, true); assert.equal(exchange.requests.length, 0); assert.equal(exchange.beforeSends, 0);
});

test("pinned SDK fee selector parity retains its five exact low-tier branch outcomes", async () => {
  const sdkUrl = new URL("./conversions-DulgS7tz.js", import.meta.resolve("@metamask/agent-sdk"));
  const sdk = await import(sdkUrl.href) as { p: (relay: unknown, input: unknown) => Promise<{ feeAmount: bigint }> };
  const originalFetch = globalThis.fetch, seen: string[] = [];
  const base = () => ({ jsonrpc: "2.0", id: 10, result: { transactions: [{ fees: [{ tokenFees: [{
    token: { address: TOKEN, symbol: "USDC", decimals: 6 }, balanceNeededToken: "0x1483",
    feeRecipient: "0x3333333333333333333333333333333333333333", error: "" }], }] }] } });
  const changes: SentinelMutation[] = [
    v => { v.result.transactions[0].fees[0].tokenFees[0].token.address = OWNER; },
    v => { v.result.transactions[0].fees[0].tokenFees[0].error = SECRET; },
    v => { delete v.result.transactions[0].fees[0].tokenFees[0].balanceNeededToken; },
    v => { v.result.transactions[0].fees[0].tokenFees[0].balanceNeededToken = "0xgg"; },
    v => { v.result.transactions.unshift({ fees: [{}] }); v.result.transactions[1].fees.push({ error: SECRET }); },
  ];
  try {
    for (const mutate of changes) {
      const value = base(); mutate(value);
      globalThis.fetch = async () => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      try {
        const result = await sdk.p({ host: "https://agentic-proxy.workers.cx.metamask.io", env: "prod" },
          { chainId: 8453, from: OWNER, executions: [{ target: TOKEN, value: 0n, callData: "0x" }], feeToken: TOKEN });
        assert.equal(result.feeAmount, 5251n); seen.push("success");
      } catch (error) {
        const code = error instanceof SyntaxError ? "SyntaxError" : (error as { code?: string }).code;
        seen.push(["GASLESS_FEE_TOKEN_UNSUPPORTED", "GASLESS_FEE_QUOTE_FAILED", "SyntaxError"].includes(code ?? "") ? code! : "unknown");
      }
    }
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(seen, ["GASLESS_FEE_TOKEN_UNSUPPORTED", "GASLESS_FEE_QUOTE_FAILED", "GASLESS_FEE_QUOTE_FAILED", "SyntaxError", "success"]);
});
