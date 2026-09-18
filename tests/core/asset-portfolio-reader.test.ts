import assert from "node:assert/strict";
import test from "node:test";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { AssetPortfolioReader, type BatchBalanceAvailable, type BatchBalanceRequest, type BatchBalanceResult, type FamilyBalanceBatchPort,
  type PortfolioAccount } from "../../src/asset-portfolio-reader.js";
import { portfolioEndpoint, type PortfolioEndpoint } from "../../src/portfolio/registry.js";

const inventory = loadAllowlistInventory();
const EVM = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const SOLANA = "7TyHe1sAhTaSCMF1uzWNhpgEoAmYQFuihxisWV6FWbUm";
const TRON = "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF";
const ETHEREUM = "eip155:1", BASE = "eip155:8453", OPTIMISM = "eip155:10", BNB = "eip155:56";
const SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const TRON_CHAIN = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
const now = () => new Date("2026-09-18T05:00:00.000Z");
const COST = { evm: { mode: "evm_multicall3_aggregate3", calls: 1, methods: 2 }, solana: { mode: "solana_json_rpc_batch", calls: 1, methods: 2 },
  tron: { mode: "tron_http_sequential", calls: 4, methods: 4 } } as const;

type Reply = (request: BatchBalanceRequest, call: number) => BatchBalanceResult | Promise<BatchBalanceResult>;
class Port implements FamilyBalanceBatchPort {
  readonly requests: BatchBalanceRequest[] = [];
  constructor(readonly family: "evm" | "solana" | "tron", private readonly reply: Reply) {}
  async read(request: BatchBalanceRequest): Promise<BatchBalanceResult> {
    this.requests.push(request);
    return await this.reply(request, this.requests.filter((entry) => entry.chain === request.chain).length);
  }
}
function available(request: BatchBalanceRequest, amount = "7"): BatchBalanceAvailable {
  const family = request.family;
  return { status: "available", ...COST[family], block: family === "solana" ? null : "100", slot: family === "solana" ? "200" : null,
    balances: request.assets.map((asset) => ({ ...asset, amountAtomic: amount })) };
}
function failure(request: BatchBalanceRequest, reason: string, httpStatus?: number): BatchBalanceResult {
  return { status: "unavailable", reason, ...(httpStatus === undefined ? {} : { httpStatus }), ...COST[request.family], calls: 1,
    methods: COST[request.family].methods } as BatchBalanceResult;
}
function ports(overrides: Partial<Record<"evm" | "solana" | "tron", Reply>> = {}) {
  return { evm: new Port("evm", overrides.evm ?? ((request) => available(request))),
    solana: new Port("solana", overrides.solana ?? ((request) => available(request))),
    tron: new Port("tron", overrides.tron ?? ((request) => available(request))) };
}
const accounts: Record<"evm" | "solana" | "tron", PortfolioAccount> = { evm: { kind: "account", address: EVM },
  solana: { kind: "account", address: SOLANA }, tron: { kind: "account", address: TRON } };
function reader(p: ReturnType<typeof ports>, waits: number[] = [], result: "elapsed" | "interrupted" = "elapsed") {
  return new AssetPortfolioReader(p, now, async (milliseconds) => { waits.push(milliseconds); return result; });
}
const defaults = (chain: string): PortfolioEndpoint => portfolioEndpoint(chain, {});
const network = (value: Awaited<ReturnType<AssetPortfolioReader["read"]>>, chain: string) => value.networks.find((entry) => entry.chain === chain)!;

test("reads every frozen-list network once per batch in list order and totals the RPC calls", async () => {
  const p = ports();
  const result = await reader(p).read({ inventory, accounts, endpoint: defaults });
  assert.deepEqual(result.networks.map((entry) => entry.chain), inventory.networks.map((entry) => entry.chain));
  assert.equal(result.networks.length, 13);
  assert.equal(result.networks.flatMap((entry) => entry.rows).length, 28);
  assert.equal(p.evm.requests.length, 11); assert.equal(p.solana.requests.length, 1); assert.equal(p.tron.requests.length, 1);
  assert.equal(result.rpcCallsTotal, 11 + 1 + 4);
  assert.equal(result.datasetSha256, inventory.dataset.sha256);
  const ethereum = network(result, ETHEREUM);
  assert.deepEqual(ethereum.rows.map((row) => [row.symbol, row.status, row.atomic, row.contract]), [
    ["ETH", "ok", "7", null], ["USDC", "ok", "7", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    ["USDT", "ok", "7", "0xdAC17F958D2ee523a2206206994597C13D831ec7"]]);
  assert.deepEqual([ethereum.rpcCalls, ethereum.attempts, ethereum.methods, ethereum.block, ethereum.slot], [1, 1, 2, "100", null]);
  assert.deepEqual(network(result, SOLANA_CHAIN).slot, "200");
  assert.deepEqual(p.evm.requests[0]!.assets, [{ kind: "native", identifier: null },
    { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, { kind: "token", identifier: "0xdAC17F958D2ee523a2206206994597C13D831ec7" }]);
});

test("HTTP 429 exhausts three attempts with 1 s then 2 s pauses and reports unavailable, never zero", async () => {
  const waits: number[] = [];
  const p = ports({ evm: (request) => request.chain === BASE ? failure(request, "rate_limited", 429) : available(request) });
  const result = await reader(p, waits).read({ inventory, accounts, endpoint: defaults });
  const base = network(result, BASE);
  assert.deepEqual(waits, [1_000, 2_000]);
  assert.deepEqual([base.attempts, base.rpcCalls, base.retried], [3, 3, ["rate_limited", "rate_limited"]]);
  assert.deepEqual(base.rows.map((row) => [row.status, row.reason, row.httpStatus, row.atomic, row.display]),
    [["unavailable", "rate_limited", 429, null, null], ["unavailable", "rate_limited", 429, null, null]]);
  assert.equal(network(result, ETHEREUM).rows.every((row) => row.status === "ok"), true);
  assert.equal(result.rpcCallsTotal, 16 - 1 + 3);
});

test("5xx, timeout and unreachable nodes are retried; a later success reports every call spent", async () => {
  const waits: number[] = [];
  const p = ports({ evm: (request, call) => request.chain === BASE
    ? call === 1 ? failure(request, "server_error", 503) : call === 2 ? failure(request, "timeout") : available(request, "9")
    : request.chain === OPTIMISM ? failure(request, "unreachable") : available(request) });
  const result = await reader(p, waits).read({ inventory, accounts, endpoint: defaults });
  const base = network(result, BASE), optimism = network(result, OPTIMISM);
  assert.deepEqual([base.attempts, base.rpcCalls, base.retried, base.rows.map((row) => row.atomic)],
    [3, 3, ["server_error", "timeout"], ["9", "9"]]);
  assert.deepEqual([optimism.attempts, optimism.rows.map((row) => row.reason)], [3, ["unreachable", "unreachable"]]);
  assert.deepEqual(waits.sort(), [1_000, 1_000, 2_000, 2_000]);
});

test("non-retryable failures end after one attempt and keep their classification", async () => {
  for (const [reason, httpStatus] of [["chain_mismatch"], ["multicall_code_mismatch"], ["protocol"], ["http_status", 404],
    ["rpc_error"], ["transport_refused"]] as const) {
    const waits: number[] = [];
    const p = ports({ evm: (request) => request.chain === ETHEREUM ? failure(request, reason, httpStatus) : available(request) });
    const ethereum = network(await reader(p, waits).read({ inventory, accounts, endpoint: defaults }), ETHEREUM);
    assert.deepEqual([ethereum.attempts, ethereum.rpcCalls, waits], [1, 1, []], reason);
    assert.deepEqual(ethereum.rows.map((row) => [row.status, row.reason, row.httpStatus]),
      Array(3).fill(["unavailable", reason, httpStatus ?? null]), reason);
  }
});

test("an interrupted pause stops retrying and reports the classified failure", async () => {
  const waits: number[] = [];
  const p = ports({ tron: (request) => failure(request, "rate_limited", 429) });
  const tron = network(await reader(p, waits, "interrupted").read({ inventory, accounts, endpoint: defaults }), TRON_CHAIN);
  assert.deepEqual([tron.attempts, waits, tron.rows.map((row) => row.reason)], [1, [1_000], ["rate_limited", "rate_limited"]]);
});

test("a partial batch keeps validated rows and marks failed or missing rows unavailable", async () => {
  const p = ports({ evm: (request) => request.chain !== ETHEREUM ? available(request) : { status: "available", ...COST.evm, block: "5", slot: null,
    balances: [{ kind: "native", identifier: null, amountAtomic: "12" },
      { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", unavailable: "partial_batch" }] } });
  const ethereum = network(await reader(p).read({ inventory, accounts, endpoint: defaults }), ETHEREUM);
  assert.deepEqual(ethereum.rows.map((row) => [row.symbol, row.status, row.reason, row.atomic]),
    [["ETH", "ok", null, "12"], ["USDC", "unavailable", "partial_batch", null], ["USDT", "unavailable", "partial_batch", null]]);
});

test("malformed, oversized, duplicated or throwing port results are protocol failures, never zero", async () => {
  const cases: Reply[] = [
    (request) => ({ ...available(request), balances: [...available(request).balances, ...available(request).balances] }) as BatchBalanceResult,
    (request) => available(request, "-1"), (request) => available(request, "01"),
    (request) => available(request, (1n << 256n).toString()),
    (request) => ({ ...available(request), block: null }) as BatchBalanceResult,
    (request) => ({ ...available(request), calls: -1 }) as BatchBalanceResult,
    (request) => ({ ...failure(request, "rate_limited"), reason: "invented" }) as unknown as BatchBalanceResult,
    () => { throw new Error("port bug"); },
  ];
  for (const [index, reply] of cases.entries()) {
    const p = ports({ evm: (request, call) => request.chain === ETHEREUM ? reply(request, call) : available(request) });
    const ethereum = network(await reader(p).read({ inventory, accounts, endpoint: defaults }), ETHEREUM);
    assert.deepEqual(ethereum.rows.map((row) => [row.status, row.reason, row.atomic]), Array(3).fill(["unavailable", "protocol", null]), String(index));
    assert.equal(ethereum.attempts, 1);
  }
  const max = network(await reader(ports({ evm: (request) => available(request, ((1n << 256n) - 1n).toString()) }))
    .read({ inventory, accounts, endpoint: defaults }), BNB);
  assert.equal(max.rows[0]!.atomic, ((1n << 256n) - 1n).toString());
});

test("absent accounts, external EVM profiles, unconfigured and invalid endpoints spend zero calls", async () => {
  const p = ports();
  const endpoint = (chain: string): PortfolioEndpoint => chain === BNB ? { source: "not_configured", env: null }
    : chain === ETHEREUM ? { source: "invalid_env", env: "APN_ETHEREUM_RPC_URL" } : defaults(chain);
  const result = await reader(p).read({ inventory, endpoint, accounts: { ...accounts, solana: { kind: "none" } } });
  assert.deepEqual(network(result, SOLANA_CHAIN).rows.map((row) => row.status), ["no_account", "no_account", "no_account"]);
  assert.deepEqual(network(result, BNB).rows.map((row) => [row.status, row.reason]), [["rpc_not_configured", null]]);
  assert.deepEqual(network(result, ETHEREUM).rows.map((row) => row.reason), Array(3).fill("rpc_config_invalid"));
  for (const chain of [SOLANA_CHAIN, BNB, ETHEREUM]) assert.deepEqual([network(result, chain).rpcCalls, network(result, chain).mode], [0, null]);
  assert.equal(p.solana.requests.length, 0);
  assert.equal(p.evm.requests.some((request) => request.chain === BNB || request.chain === ETHEREUM), false);
  assert.equal(result.rpcCallsTotal, 9 + 4);
  const external = await reader(ports()).read({ inventory, endpoint: defaults,
    accounts: { ...accounts, evm: { kind: "unsupported", reason: "external_provider_profile" } } });
  assert.equal(external.networks.filter((entry) => entry.family === "evm").every((entry) =>
    entry.rpcCalls === 0 && entry.account === null && entry.rows.every((row) => row.reason === "external_provider_profile")), true);
});

test("amounts stay exact atomic integers and display with the list decimals", async () => {
  const amounts: Record<string, string> = { native: "1234567890123456789", token: "1000001" };
  const p = ports({
    evm: (request) => ({ ...available(request), balances: request.assets.map((asset) => ({ ...asset, amountAtomic: amounts[asset.kind]! })) }),
    solana: (request) => ({ ...available(request), balances: request.assets.map((asset) => ({ ...asset, amountAtomic: asset.kind === "native" ? "1" : "0" })) }),
    tron: (request) => ({ ...available(request), balances: request.assets.map((asset) => ({ ...asset, amountAtomic: asset.kind === "native" ? "5000000" : "123456789012" })) }),
  });
  const result = await reader(p).read({ inventory, accounts, endpoint: defaults });
  assert.deepEqual(network(result, ETHEREUM).rows.map((row) => [row.decimals, row.atomic, row.display]),
    [[18, "1234567890123456789", "1.234567890123456789"], [6, "1000001", "1.000001"], [6, "1000001", "1.000001"]]);
  assert.deepEqual(network(result, SOLANA_CHAIN).rows.map((row) => [row.decimals, row.display]), [[9, "0.000000001"], [6, "0"], [6, "0"]]);
  assert.deepEqual(network(result, TRON_CHAIN).rows.map((row) => [row.symbol, row.display]), [["TRX", "5"], ["USDT", "123456.789012"]]);
});

test("only pinned public defaults are echoed; owner endpoints are named by variable, never by URL", async () => {
  const endpoint = (chain: string) => portfolioEndpoint(chain, { APN_BASE_RPC_URL: "https://base.example/v2/owner-secret" });
  const result = await reader(ports()).read({ inventory, accounts, endpoint });
  assert.deepEqual(network(result, BASE).endpoint, { source: "env", env: "APN_BASE_RPC_URL", url: null });
  assert.deepEqual(network(result, ETHEREUM).endpoint, { source: "default_public", env: "APN_ETHEREUM_RPC_URL", url: "https://ethereum-rpc.publicnode.com" });
  assert.equal(JSON.stringify(result).includes("owner-secret"), false);
});

test("account states are exact and canonical", async () => {
  await assert.rejects(reader(ports()).read({ inventory, endpoint: defaults,
    accounts: { ...accounts, evm: { kind: "account", address: EVM.toLowerCase() } } }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(reader(ports()).read({ inventory, endpoint: defaults,
    accounts: { evm: accounts.evm, solana: accounts.solana } as never }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => new AssetPortfolioReader({ ...ports(), tron: new Port("solana", (request) => available(request)) },
    now, async () => "elapsed"), { code: "APN_INVALID_INPUT" });
});
