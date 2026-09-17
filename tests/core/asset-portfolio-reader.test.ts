import assert from "node:assert/strict";
import test from "node:test";
import { AssetPortfolioReader, type BatchBalanceRequest, type BatchBalanceResult,
  type FamilyBalanceBatchPort } from "../../src/asset-portfolio-reader.js";
import { sealAssetPolicyRegistry, type AssetPolicyChain, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";

const EVM_ACCOUNT = "0x0000000000000000000000000000000000000001";
const EVM_ACCOUNT_TWO = "0x0000000000000000000000000000000000000002";
const EVM_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SOL_ACCOUNT = "11111111111111111111111111111111";
const SOL_TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRON_ACCOUNT = "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF";
const TRON_TOKEN = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const rails = { direct: true, gasless: false, x402: false, bridge: false, swap: false } as const;
const caps = { maximumPerTransferAtomic: "1000", dailyLimitAtomic: "3000" } as const;
const at = "2026-09-17T05:00:00.000Z";

function chain(family: "evm" | "solana" | "tron"): AssetPolicyChain {
  if (family === "evm") return { chain: "eip155:1", family, name: "Ethereum", assets: [
    { kind: "token", identifier: EVM_TOKEN, symbol: "USDC", decimals: 6, rails, caps },
    { kind: "native", identifier: null, symbol: "ETH", decimals: 18, rails, caps },
  ] };
  if (family === "solana") return { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", family, name: "Solana", assets: [
    { kind: "token", identifier: SOL_TOKEN, symbol: "USDC", decimals: 6, rails, caps },
    { kind: "native", identifier: null, symbol: "SOL", decimals: 9, rails, caps },
  ] };
  return { chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", family, name: "TRON", assets: [
    { kind: "token", identifier: TRON_TOKEN, symbol: "USDT", decimals: 6, rails, caps },
    { kind: "native", identifier: null, symbol: "TRX", decimals: 6, rails, caps },
  ] };
}

function registry(families: readonly ("evm" | "solana" | "tron")[] = ["tron", "evm", "solana"], version = "portfolio.1") {
  const value: UnsignedAssetPolicyRegistry = { schemaVersion: "apn.asset-policy-registry.v1", registryVersion: version,
    publishedAt: at, effectiveDate: "2026-09-18", chains: families.map(chain) };
  return sealAssetPolicyRegistry(value);
}

function accounts(families: readonly ("evm" | "solana" | "tron")[] = ["evm", "solana", "tron"], evm = EVM_ACCOUNT) {
  return families.map((family) => ({ chain: chain(family).chain,
    account: family === "evm" ? evm : family === "solana" ? SOL_ACCOUNT : TRON_ACCOUNT }));
}

class Port implements FamilyBalanceBatchPort {
  readonly calls: BatchBalanceRequest[] = [];
  constructor(readonly family: "evm" | "solana" | "tron", readonly source: string,
    private readonly reply: (request: BatchBalanceRequest, call: number) => BatchBalanceResult | Promise<BatchBalanceResult>) {}
  async read(request: BatchBalanceRequest): Promise<BatchBalanceResult> {
    this.calls.push(structuredClone(request)); return await this.reply(request, this.calls.length);
  }
}

function available(family: "evm" | "solana" | "tron",
  balances: readonly { readonly kind: "native" | "token"; readonly identifier: string | null; readonly amountAtomic: string }[]): BatchBalanceResult {
  return { status: "available", observedAt: at, block: family === "solana" ? null : "100", slot: family === "solana" ? "200" : null,
    balances };
}
function all(request: BatchBalanceRequest, family: "evm" | "solana" | "tron", amount = "7"): BatchBalanceResult {
  return available(family, request.assets.map((asset) => ({ ...asset, amountAtomic: amount })));
}
function ports(overrides: Partial<Record<"evm" | "solana" | "tron", Port>> = {}) {
  return {
    evm: overrides.evm ?? new Port("evm", "fixture:evm", (request) => all(request, "evm")),
    solana: overrides.solana ?? new Port("solana", "fixture:solana", (request) => all(request, "solana")),
    tron: overrides.tron ?? new Port("tron", "fixture:tron", (request) => all(request, "tron")),
  };
}

test("portfolio batches once per network in deterministic order and keeps zero distinct from unavailable", async () => {
  const evm = new Port("evm", "fixture:evm", (request) => available("evm", [
    { ...request.assets[0]!, amountAtomic: "0" },
  ]));
  const p = ports({ evm }), reader = new AssetPortfolioReader(p, () => Date.parse(at), async () => {});
  const result = await reader.read(registry(), accounts(), { availableTtlMs: 10_000, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 3);
  assert.deepEqual(result.networks.map((row) => row.chain), ["eip155:1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc"]);
  assert.equal(p.evm.calls.length, 1); assert.equal(p.solana.calls.length, 1); assert.equal(p.tron.calls.length, 1);
  assert.equal(p.evm.calls[0]!.mode, "evm_multicall");
  assert.equal(p.solana.calls[0]!.mode, "solana_native_and_token_accounts");
  assert.equal(p.tron.calls[0]!.mode, "tron_native_and_trc20");
  assert.deepEqual(p.evm.calls[0]!.assets.map((asset) => asset.kind), ["native", "token"]);
  const observations = result.networks[0]!.balances.map((row) => row.observation);
  assert.deepEqual(observations[0], { status: "available", amountAtomic: "0",
    provenance: { block: "100", slot: null, observedAt: at, source: "fixture:evm", attempts: 1 } });
  const missing = observations[1]!;
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.status === "unavailable" && missing.reason, "partial_batch");
  assert.equal(result.networks[0]!.cache.unavailableCached, false);
});

test("only explicit HTTP 429 retries, then records success or bounded exhaustion", async () => {
  const waits: number[] = [];
  const success = new Port("evm", "fixture:evm", (request, call) => call === 1 ?
    { status: "unavailable", reason: "rate_limited", httpStatus: 429, observedAt: at, block: null, slot: null } : all(request, "evm"));
  let reader = new AssetPortfolioReader(ports({ evm: success }), () => Date.parse(at), async (ms) => { waits.push(ms); });
  let result = await reader.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 2); assert.deepEqual(waits, [1_000]);
  assert.equal(result.networks[0]!.balances[0]!.observation.provenance.attempts, 2);

  const exhausted = new Port("evm", "fixture:evm", () =>
    ({ status: "unavailable", reason: "rate_limited", httpStatus: 429, observedAt: at, block: null, slot: null }));
  reader = new AssetPortfolioReader(ports({ evm: exhausted }), () => Date.parse(at), async () => {});
  result = await reader.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 3); assert.equal(exhausted.calls.length, 3);
  const unavailable = result.networks[0]!.balances[0]!.observation;
  assert.equal(unavailable.status, "unavailable"); assert.equal(unavailable.status === "unavailable" && unavailable.reason, "rate_limited");
  assert.equal(unavailable.provenance.attempts, 3);

  const noRetry = new Port("evm", "fixture:evm", () =>
    ({ status: "unavailable", reason: "transport", httpStatus: 503, observedAt: at, block: null, slot: null }));
  reader = new AssetPortfolioReader(ports({ evm: noRetry }), () => Date.parse(at), async () => {});
  result = await reader.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1); assert.equal(noRetry.calls.length, 1);
});

test("cache expiry, account and dataset digest isolate reads; unavailable caching is explicit", async () => {
  let now = Date.parse(at);
  const evm = new Port("evm", "fixture:evm", (request) => all(request, "evm"));
  const reader = new AssetPortfolioReader(ports({ evm }), () => now, async () => {});
  const policy = { availableTtlMs: 1_000, unavailableTtlMs: 500 };
  let result = await reader.read(registry(["evm"]), accounts(["evm"]), policy);
  assert.equal(result.requestCount, 1); assert.equal(result.networks[0]!.cache.state, "miss");
  (result.networks[0]!.balances[0]!.observation as any).amountAtomic = "0";
  result = await reader.read(registry(["evm"]), accounts(["evm"]), policy);
  assert.equal(result.requestCount, 0); assert.equal(result.networks[0]!.cache.state, "fresh");
  assert.equal(result.networks[0]!.balances[0]!.observation.status === "available" &&
    result.networks[0]!.balances[0]!.observation.amountAtomic, "7");
  now += 1_000;
  result = await reader.read(registry(["evm"]), accounts(["evm"]), policy);
  assert.equal(result.requestCount, 1); assert.equal(result.networks[0]!.cache.state, "expired");
  result = await reader.read(registry(["evm"]), accounts(["evm"], EVM_ACCOUNT_TWO), policy);
  assert.equal(result.requestCount, 1);
  result = await reader.read(registry(["evm"], "portfolio.2"), accounts(["evm"]), policy);
  assert.equal(result.requestCount, 1); assert.equal(evm.calls.length, 4);

  const unavailable = new Port("evm", "fixture:evm", () =>
    ({ status: "unavailable", reason: "transport", observedAt: at, block: null, slot: null }));
  const uncached = new AssetPortfolioReader(ports({ evm: unavailable }), () => now, async () => {});
  await uncached.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  result = await uncached.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1); assert.equal(unavailable.calls.length, 2); assert.equal(result.networks[0]!.cache.unavailableCached, false);
  const cachedUnavailable = new AssetPortfolioReader(ports({ evm: unavailable }), () => now, async () => {});
  result = await cachedUnavailable.read(registry(["evm"]), accounts(["evm"]), policy);
  assert.equal(result.networks[0]!.cache.unavailableCached, true);
  result = await cachedUnavailable.read(registry(["evm"]), accounts(["evm"]), policy);
  assert.equal(result.requestCount, 0); assert.equal(result.networks[0]!.cache.state, "fresh");
});

test("duplicate batch assets fail the network closed without changing its one-request count", async () => {
  const evm = new Port("evm", "fixture:evm", (request) => available("evm", [
    { ...request.assets[0]!, amountAtomic: "1" }, { ...request.assets[0]!, amountAtomic: "2" },
  ]));
  const result = await new AssetPortfolioReader(ports({ evm }), () => Date.parse(at), async () => {})
    .read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1); assert.equal(evm.calls.length, 1);
  assert.ok(result.networks[0]!.balances.every((row) =>
    row.observation.status === "unavailable" && row.observation.reason === "protocol"));
});

test("malformed available provenance becomes explicit unavailable and never a synthetic zero", async () => {
  const evm = new Port("evm", "fixture:evm", (request) => ({ ...all(request, "evm"), block: null } as BatchBalanceResult));
  const result = await new AssetPortfolioReader(ports({ evm }), () => Date.parse(at), async () => {})
    .read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1);
  for (const row of result.networks[0]!.balances) {
    assert.deepEqual(row.observation, { status: "unavailable", reason: "protocol",
      provenance: { block: null, slot: null, observedAt: at, source: "fixture:evm", attempts: 1 } });
  }
});

test("runtime provider envelopes are exact and malformed 429 claims are not retried", async () => {
  const malformed = new Port("evm", "fixture:evm", () => ({
    status: "unavailable", reason: "invented", httpStatus: 429, observedAt: at, block: null, slot: null, extra: true,
  } as unknown as BatchBalanceResult));
  const result = await new AssetPortfolioReader(ports({ evm: malformed }), () => Date.parse(at), async () => {
    assert.fail("a malformed provider envelope must not retry");
  }).read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1); assert.equal(malformed.calls.length, 1);
  assert.ok(result.networks[0]!.balances.every((row) =>
    row.observation.status === "unavailable" && row.observation.reason === "protocol"));
});

test("cache policy changes are isolated and cannot reuse a longer prior TTL", async () => {
  let now = Date.parse(at);
  const evm = new Port("evm", "fixture:evm", (request) => all(request, "evm"));
  const reader = new AssetPortfolioReader(ports({ evm }), () => now, async () => {});
  await reader.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 10_000, unavailableTtlMs: 0 });
  now += 1;
  const result = await reader.read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1, unavailableTtlMs: 0 });
  assert.equal(result.requestCount, 1); assert.equal(result.networks[0]!.cache.state, "miss"); assert.equal(evm.calls.length, 2);
});

test("registry and port descriptor mutation cannot escape the validated digest snapshot", async () => {
  const sealed = registry(["evm"]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = new Port("evm", "fixture:evm", async (request) => { await gate; return all(request, "evm"); });
  const descriptor = ports({ evm: original });
  const reader = new AssetPortfolioReader(descriptor, () => Date.parse(at), async () => {});
  const pending = reader.read(sealed, accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  (sealed.chains[0]!.assets[0] as any).symbol = "FAKE";
  (descriptor as any).evm = new Port("evm", "fixture:replaced", () => { assert.fail("replacement port used"); });
  release();
  const result = await pending;
  assert.equal(result.datasetDigest, sealed.policyDigest);
  assert.deepEqual(result.networks[0]!.balances.map((row) => row.asset.symbol), ["ETH", "USDC"]);
  assert.ok(result.networks[0]!.balances.every((row) => row.observation.status === "available"));
});

test("noncanonical provider identities fail the whole network as protocol data", async () => {
  const evm = new Port("evm", "fixture:evm", (request) => available("evm", [
    { ...request.assets[0]!, amountAtomic: "1" },
    { kind: "token", identifier: EVM_TOKEN.toLowerCase(), amountAtomic: "2" },
  ]));
  const result = await new AssetPortfolioReader(ports({ evm }), () => Date.parse(at), async () => {})
    .read(registry(["evm"]), accounts(["evm"]), { availableTtlMs: 1_000, unavailableTtlMs: 0 });
  assert.ok(result.networks[0]!.balances.every((row) =>
    row.observation.status === "unavailable" && row.observation.reason === "protocol"));
});
