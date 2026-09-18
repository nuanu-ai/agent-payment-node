import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, keccak256, toHex, type Hex } from "viem";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import type { ChainWalletStoragePort } from "../../src/direct-rail-ports.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { EvmPortfolioPort } from "../../src/portfolio/evm-reader.js";
import { PortfolioTransportFailure, type PortfolioHttpPort, type PortfolioHttpResponse } from "../../src/portfolio/https.js";
import { MULTICALL3_ADDRESS, PORTFOLIO_NETWORK_RPC, portfolioEndpoint } from "../../src/portfolio/registry.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const EVM = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7", SOLANA = "7TyHe1sAhTaSCMF1uzWNhpgEoAmYQFuihxisWV6FWbUm";
const TRON = "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const TRON_GENESIS = "00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CODE = readFileSync(resolve("tests/core/fixtures/multicall3-runtime-code.hex"), "utf8").trim() as Hex;
// Linea and Sei: byte-identical runtime code except the 32-byte solc IPFS metadata hash.
const ALTERNATE = CODE.replace("bb2b5c71a328032f97c676ae39a1ec2148d3e5d6f73d95e9b17910152d61f162",
  "5262896e64c2976ac864a70800bed9e323dddd5becdf2827aed842bbc4b1b6e9") as Hex;
const MC3 = [
  { type: "function", name: "aggregate3", stateMutability: "payable", inputs: [{ name: "calls", type: "tuple[]", components: [
    { name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }],
  outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }] },
  { type: "function", name: "getChainId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getBlockNumber", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const ERC20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const word = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
type Rpc = { readonly id: string; readonly method: string; readonly params: readonly unknown[] };
type Forced = number | "timeout" | "unreachable";

/** Answers the pinned default hosts like the real chains do; no network access. */
class FakeChains implements PortfolioHttpPort {
  readonly requests: { readonly host: string; readonly path: string; readonly methods: readonly string[] }[] = [];
  readonly forced = new Map<string, Forced[]>();
  readonly hosts = new Map(PORTFOLIO_NETWORK_RPC.filter((row) => row.evmChainId !== null)
    .map((row) => [new URL(row.defaultEndpoint).host, row.evmChainId!] as const));
  readonly code = new Map<number, Hex>(); readonly reportedChain = new Map<number, bigint>();
  failingToken: string | null = null; emptyToken: string | null = null; solanaGenesis = SOLANA_GENESIS; usdcAta = "";

  async post(url: URL, body: string): Promise<PortfolioHttpResponse> {
    const parsed = JSON.parse(body) as Rpc[] | Record<string, unknown>;
    this.requests.push({ host: url.host, path: url.pathname, methods: Array.isArray(parsed) ? parsed.map((item) => item.method) : [url.pathname] });
    const forced = this.forced.get(url.host)?.shift();
    if (forced === "timeout" || forced === "unreachable") throw new PortfolioTransportFailure(forced);
    if (forced !== undefined) return { status: forced, contentType: "application/json", body: "{\"error\":\"forced\"}" };
    const reply = (value: unknown) => ({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(value) });
    if (url.host === "api.trongrid.io") return reply(this.tron(url.pathname, parsed as Record<string, unknown>));
    const batch = parsed as Rpc[];
    if (url.host === "api.mainnet-beta.solana.com") return reply(batch.map((item) => ({ jsonrpc: "2.0", result: this.solana(item), id: item.id })));
    const chainId = this.hosts.get(url.host);
    if (chainId === undefined) throw new Error(`unexpected host ${url.host}`);
    return reply(batch.map((item) => ({ jsonrpc: "2.0", id: item.id, result: this.evm(chainId, item) })));
  }

  private evm(chainId: number, item: Rpc): unknown {
    const pin = PORTFOLIO_NETWORK_RPC.find((row) => row.evmChainId === chainId)!.multicall3CodeHash;
    if (item.method === "eth_getCode") return this.code.get(chainId) ?? (pin === keccak256(ALTERNATE) ? ALTERNATE : CODE);
    if (item.method === "eth_chainId") return toHex(this.reportedChain.get(chainId) ?? BigInt(chainId));
    if (item.method === "eth_blockNumber") return "0x309";
    if (item.method === "eth_getBalance") return toHex(1234567890123456789n);
    const call = item.params[0] as { readonly to: string; readonly data: Hex };
    if (getAddress(call.to) !== MULTICALL3_ADDRESS) return word(1000001n);
    const decoded = decodeFunctionData({ abi: MC3, data: call.data });
    if (decoded.functionName !== "aggregate3") throw new Error("unexpected multicall function");
    return encodeFunctionResult({ abi: MC3, functionName: "aggregate3", result: decoded.args[0].map((entry) => {
      if (entry.target === this.failingToken) return { success: false, returnData: "0x" as Hex };
      if (entry.target === this.emptyToken) return { success: true, returnData: "0x" as Hex };
      if (getAddress(entry.target) !== MULTICALL3_ADDRESS) return { success: true, returnData: word(1000001n) };
      const inner = decodeFunctionData({ abi: MC3, data: entry.callData });
      const value = inner.functionName === "getChainId" ? this.reportedChain.get(chainId) ?? BigInt(chainId)
        : inner.functionName === "getBlockNumber" ? 777n : 1234567890123456789n;
      return { success: true, returnData: word(value) };
    }) });
  }

  private solana(item: Rpc): unknown {
    if (item.method === "getGenesisHash") return this.solanaGenesis;
    const [addresses] = item.params as [string[]];
    return { context: { apiVersion: "4.3.0", slot: 4242 }, value: addresses.map((key, index) => index === 0
      ? { data: ["", "base64"], executable: false, lamports: 2500000000, owner: SYSTEM_PROGRAM_ADDRESS, rentEpoch: 0, space: 0 }
      : key === this.usdcAta ? { data: [Buffer.from(getTokenEncoder().encode({ mint: address(SOL_USDC), owner: address(SOLANA), amount: 160000n,
        delegate: null, state: 1, isNative: null, delegatedAmount: 0n, closeAuthority: null })).toString("base64"), "base64"],
        executable: false, lamports: 2039280, owner: TOKEN_PROGRAM_ADDRESS, rentEpoch: 0, space: 165 } : null) };
  }

  private tron(path: string, body: Record<string, unknown>): unknown {
    if (path === "/wallet/getblockbynum" && body.num === 0) return { blockID: TRON_GENESIS, block_header: { raw_data: {} } };
    if (path === "/walletsolidity/getnowblock") return { blockID: `${(86344362).toString(16).padStart(16, "0")}${"ab".repeat(24)}`,
      block_header: { raw_data: { number: 86344362, timestamp: 1758171600000 } } };
    if (path === "/walletsolidity/getaccount") return { address: body.address, balance: 5000000 };
    if (path === "/walletsolidity/triggerconstantcontract" && body.function_selector === "balanceOf(address)") {
      return { result: { result: true }, constant_result: [(1095165n).toString(16).padStart(64, "0")] };
    }
    throw new Error(`unexpected TRON path ${path}`);
  }
}

const chainAccounts = (rails: readonly ("solana" | "tron")[]) => ({
  account: async (profile: string, rail: "solana" | "tron") => rails.includes(rail)
    ? { profile, rail, address: rail === "solana" ? SOLANA : TRON } : null,
}) as unknown as ChainWalletStoragePort;

async function portfolio(chains: FakeChains, options: { readonly environment?: Record<string, string>;
  readonly rails?: readonly ("solana" | "tron")[]; readonly evmWallet?: boolean } = {}) {
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root);
    await state.initialize();
    if (options.evmWallet !== false) await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile: "default",
      profileHash: state.profileHash("default"), address: EVM, createdAt: "2026-09-18T00:00:00.000Z", bindingHash: "0".repeat(64) }));
    const waits: number[] = [];
    const core = new ApnCore({ state, chainAccounts: chainAccounts(options.rails ?? ["solana", "tron"]),
      portfolio: { environment: options.environment ?? {}, http: chains,
        wait: async (milliseconds) => { waits.push(milliseconds); return "elapsed"; } } });
    const envelope = await core.execute({ command: "wallet.portfolio", profile: "default" });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    return { data: envelope.data as PortfolioData, waits };
  } finally { await temporary.cleanup(); }
}
interface PortfolioData {
  readonly rpc_calls_total: number;
  readonly summary: Record<string, number>;
  readonly networks: readonly { readonly chain: string; readonly endpoint: Record<string, unknown>;
    readonly rpc: { readonly mode: string | null; readonly calls: number; readonly attempts: number; readonly methods: number;
      readonly retried: readonly string[] };
    readonly provenance: Record<string, unknown>;
    readonly rows: readonly { readonly symbol: string; readonly status: string; readonly atomic: string | null; readonly display: string | null;
      readonly reason?: string; readonly http_status?: number }[] }[];
}
const net = (data: PortfolioData, chain: string) => data.networks.find((entry) => entry.chain === chain)!;
async function fakeChains(): Promise<FakeChains> {
  const chains = new FakeChains();
  chains.usdcAta = (await findAssociatedTokenPda({ owner: address(SOLANA), mint: address(SOL_USDC), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  return chains;
}

test("keyless full read: 11 Multicall3 batches, 1 Solana batch and 4 TRON calls — 16 RPC calls for 28 rows", async () => {
  const chains = await fakeChains();
  const { data } = await portfolio(chains);
  assert.equal(data.rpc_calls_total, 16);
  assert.equal(chains.requests.length, 16);
  assert.deepEqual(data.summary, { networks: 13, rows: 28, ok: 28, unavailable: 0, no_account: 0, rpc_not_configured: 0 });
  for (const row of PORTFOLIO_NETWORK_RPC) {
    const entry = net(data, row.chain);
    assert.deepEqual(entry.endpoint, { source: "default_public", env: row.env, url: row.defaultEndpoint });
    assert.deepEqual(entry.rpc, row.family === "evm" ? { mode: "evm_multicall3_aggregate3", calls: 1, attempts: 1, methods: 2, retried: [] }
      : row.family === "solana" ? { mode: "solana_json_rpc_batch", calls: 1, attempts: 1, methods: 2, retried: [] }
      : { mode: "tron_http_sequential", calls: 4, attempts: 1, methods: 4, retried: [] }, row.chain);
  }
  assert.deepEqual(chains.requests.filter((request) => request.methods.includes("eth_call")).map((request) => request.methods),
    Array(11).fill(["eth_getCode", "eth_call"]));
  assert.deepEqual(net(data, "eip155:1").rows.map((row) => [row.symbol, row.atomic, row.display]),
    [["ETH", "1234567890123456789", "1.234567890123456789"], ["USDC", "1000001", "1.000001"], ["USDT", "1000001", "1.000001"]]);
  assert.deepEqual(net(data, "eip155:1").provenance.block, "777");
  const solana = net(data, `solana:${SOLANA_GENESIS}`);
  assert.deepEqual(solana.rows.map((row) => [row.symbol, row.status, row.display]), [["SOL", "ok", "2.5"], ["USDC", "ok", "0.16"], ["USDT", "ok", "0"]]);
  assert.equal(solana.provenance.slot, "4242");
  const tron = net(data, `tron:${TRON_GENESIS}`);
  assert.deepEqual(tron.rows.map((row) => [row.symbol, row.display]), [["TRX", "5"], ["USDT", "1.095165"]]);
  assert.deepEqual(chains.requests.filter((request) => request.host === "api.trongrid.io").map((request) => request.path), [
    "/wallet/getblockbynum", "/walletsolidity/getnowblock", "/walletsolidity/getaccount", "/walletsolidity/triggerconstantcontract"]);
});

test("the pinned Multicall3 hashes are the fixture runtime code, and all 13 list networks have one keyless default", () => {
  assert.deepEqual(PORTFOLIO_NETWORK_RPC.map((row) => row.chain), loadAllowlistInventory().networks.map((row) => row.chain));
  for (const row of PORTFOLIO_NETWORK_RPC) {
    assert.match(row.defaultEndpoint, /^https:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9/_-]*)?$/u, row.chain);
    if (row.family !== "evm") continue;
    assert.equal(row.multicall3CodeHash, ["eip155:59144", "eip155:1329"].includes(row.chain) ? keccak256(ALTERNATE) : keccak256(CODE), row.chain);
  }
  assert.equal(portfolioEndpoint("eip155:56", {}).source, "default_public");
  assert.equal(portfolioEndpoint("eip155:56", { APN_BNB_RPC_URL: "" }).source, "default_public");
  assert.equal(portfolioEndpoint("eip155:56", { APN_BNB_RPC_URL: "https://bnb.example/key?x=1" }).source, "env");
  for (const [chain, env, value] of [["eip155:56", "APN_BNB_RPC_URL", "http://bnb.example"],
    ["eip155:1", "APN_ETHEREUM_RPC_URL", "https://user:pass@eth.example"],
    [`solana:${SOLANA_GENESIS}`, "APN_SOLANA_RPC_URL", "https://solana.example/?api-key=secret"],
    [`tron:${TRON_GENESIS}`, "APN_TRON_RPC_URL", "https://tron.example:8443"]] as const) {
    assert.deepEqual(portfolioEndpoint(chain, { [env]: value }), { source: "invalid_env", env }, value);
  }
  assert.deepEqual(portfolioEndpoint("eip155:999", {}), { source: "not_configured", env: null });
});

test("an owner env override replaces one default, is used, and its URL is never printed", async () => {
  const chains = await fakeChains();
  chains.hosts.set("base.example", 8453);
  const { data } = await portfolio(chains, { environment: { APN_BASE_RPC_URL: "https://base.example/v2/owner-secret" } });
  assert.deepEqual(net(data, "eip155:8453").endpoint, { source: "env", env: "APN_BASE_RPC_URL", url: null });
  assert.equal(chains.requests.some((request) => request.host === "mainnet.base.org"), false);
  assert.deepEqual(chains.requests.filter((request) => request.host === "base.example").map((request) => request.path), ["/v2/owner-secret"]);
  assert.equal(JSON.stringify(data).includes("owner-secret"), false);
  assert.equal(net(data, "eip155:8453").rows.every((row) => row.status === "ok"), true);
});

test("a default endpoint answering HTTP 429 is unavailable after 3 attempts with 1 s and 2 s pauses; others still read", async () => {
  const chains = await fakeChains();
  chains.forced.set("mainnet.base.org", [429, 429, 429]);
  chains.forced.set("mainnet.optimism.io", [503, "timeout"]);
  chains.forced.set("api.trongrid.io", ["unreachable", "unreachable", "unreachable"]);
  const { data, waits } = await portfolio(chains);
  const base = net(data, "eip155:8453"), optimism = net(data, "eip155:10"), tron = net(data, `tron:${TRON_GENESIS}`);
  assert.deepEqual(base.rows.map((row) => [row.status, row.reason, row.http_status, row.atomic, row.display]),
    Array(2).fill(["unavailable", "rate_limited", 429, null, null]));
  assert.deepEqual([base.rpc.calls, base.rpc.attempts], [3, 3]);
  assert.deepEqual([optimism.rpc.calls, optimism.rpc.attempts, optimism.rpc.retried, optimism.rows.map((row) => row.status)],
    [3, 3, ["server_error", "timeout"], ["ok", "ok"]]);
  assert.deepEqual([tron.rpc.calls, tron.rpc.attempts, tron.rows.map((row) => row.reason)], [3, 3, ["unreachable", "unreachable"]]);
  assert.deepEqual(waits.sort(), [1_000, 1_000, 1_000, 2_000, 2_000, 2_000]);
  assert.equal(data.rpc_calls_total, 16 - 2 + 3 + 3 - 4 + 3);
  assert.equal(net(data, "eip155:1").rows.every((row) => row.status === "ok"), true);
});

test("Multicall3 code mismatch and a wrong chain fail closed without retry; a failing token is one partial row", async () => {
  const chains = await fakeChains();
  chains.code.set(42161, "0x6001600055");
  chains.code.set(130, "0x");
  chains.reportedChain.set(10, 11155420n);
  chains.failingToken = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  chains.emptyToken = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const { data, waits } = await portfolio(chains);
  for (const chain of ["eip155:42161", "eip155:130"]) {
    assert.deepEqual(net(data, chain).rows.map((row) => row.reason), ["multicall_code_mismatch", "multicall_code_mismatch"], chain);
    assert.deepEqual([net(data, chain).rpc.calls, net(data, chain).rpc.attempts], [1, 1]);
  }
  assert.deepEqual(net(data, "eip155:10").rows.map((row) => row.reason), ["chain_mismatch", "chain_mismatch"]);
  assert.deepEqual(net(data, "eip155:1").rows.map((row) => [row.symbol, row.status, row.reason ?? null]),
    [["ETH", "ok", null], ["USDC", "unavailable", "partial_batch"], ["USDT", "unavailable", "protocol"]]);
  assert.deepEqual(waits, []);
});

test("a Solana genesis mismatch is unavailable; profiles without Solana or TRON accounts spend no calls there", async () => {
  const chains = await fakeChains();
  chains.solanaGenesis = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
  const { data } = await portfolio(chains, { rails: [] });
  const solana = net(data, `solana:${SOLANA_GENESIS}`), tron = net(data, `tron:${TRON_GENESIS}`);
  assert.deepEqual([solana.rows.map((row) => row.status), solana.rpc.calls], [["no_account", "no_account", "no_account"], 0]);
  assert.deepEqual([tron.rows.map((row) => row.status), tron.rpc.calls], [["no_account", "no_account"], 0]);
  assert.equal(data.rpc_calls_total, 11);
  const withSolana = await portfolio(chains, { rails: ["solana"], evmWallet: false });
  assert.deepEqual(net(withSolana.data, `solana:${SOLANA_GENESIS}`).rows.map((row) => row.reason), Array(3).fill("chain_mismatch"));
  assert.equal(withSolana.data.summary.no_account, 23 + 2);
});

test("a chain without a pinned Multicall3 is read with one plain JSON-RPC batch array", async () => {
  const chains = await fakeChains();
  const registry = PORTFOLIO_NETWORK_RPC.map((row) => row.chain === "eip155:1" ? { ...row, multicall3CodeHash: null } : row);
  const result = await new EvmPortfolioPort(chains, registry).read({ chain: "eip155:1", family: "evm", account: EVM,
    endpoint: "https://ethereum-rpc.publicnode.com/", assets: [{ kind: "native", identifier: null },
      { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }] });
  assert.deepEqual(result, { status: "available", mode: "evm_json_rpc_batch", calls: 1, methods: 4, block: "777", slot: null,
    balances: [{ kind: "native", identifier: null, amountAtomic: "1234567890123456789" },
      { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amountAtomic: "1000001" }] });
  assert.deepEqual(chains.requests[0]!.methods, ["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call"]);
});

test("wallet portfolio is one read-only catalog command in CLI and MCP with the default profile", () => {
  assert.deepEqual(bindArgv(["wallet", "portfolio"]), { request: { command: "wallet.portfolio", profile: "default" } });
  assert.deepEqual(bindArgv(["wallet", "portfolio", "--profile", "ops"]), { request: { command: "wallet.portfolio", profile: "ops" } });
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_wallet_portfolio");
  assert.ok(tool);
  assert.deepEqual([tool.command.effect.class, tool.command.approval.class, tool.inputSchema.required], ["network_read", "none", []]);
});
