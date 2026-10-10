import assert from "node:assert/strict";
import test from "node:test";
import { chmod, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { AssetPortfolioReader, type AssetPortfolioInput, type BatchBalanceResult, type FamilyBalanceBatchPort } from "../../src/asset-portfolio-reader.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { StateStore } from "../../src/state.js";
import { portfolioEndpoint } from "../../src/portfolio/registry.js";
import { ApnCore } from "../../src/core.js";
import { temporaryState, TestNative, TestRpc, TestClock, TestProfilePolicy, ensureWallet, prepareTransfer } from "./helpers.js";
import { CanonicalDirectTestNative } from "./canonical-direct-native-fixture.js";

const full = loadAllowlistInventory();
const inventory = { ...full, networks: full.networks.filter((v) => v.chain === "eip155:1"), assets: full.assets.filter((v) => v.chain === "eip155:1") };
const accounts = { evm: { kind: "account", address: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7" }, solana: { kind: "none" }, tron: { kind: "none" } } as const;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  let ms = Date.parse("2026-10-05T00:00:00.000Z"), calls = 0;
  let fail: "none" | "unavailable" | "partial" = "none";
  const port: FamilyBalanceBatchPort = { family: "evm", read: async (request): Promise<BatchBalanceResult> => {
    calls += 1;
    if (fail === "unavailable") return { status: "unavailable", reason: "protocol", mode: "evm_json_rpc_batch", calls: 1, methods: 4 };
    return { status: "available", mode: "evm_json_rpc_batch", calls: 1, methods: 4, block: "123", slot: null,
      balances: request.assets.slice(0, fail === "partial" ? 1 : undefined).map((v) => ({ ...v, amountAtomic: "0" })) };
  } };
  const input: AssetPortfolioInput = { inventory, accounts, endpoint: (chain) => portfolioEndpoint(chain, {}),
    cache: { state, profileHash: state.profileHash("default"), profileIdentity: hashObject({ revision: 1 }) } };
  return { state, temp, input, clock: { now: () => new Date(ms) }, calls: () => calls, advance: (v: number) => { ms += v; }, failure: (v: typeof fail) => { fail = v; },
    read: (value = input) => new AssetPortfolioReader({ evm: port, solana: { ...port, family: "solana" }, tron: { ...port, family: "tron" } },
      () => new Date(ms), async () => "elapsed").read(value) };
}
test("new reader instances reuse secure persistent zero balances, preserve capture counts and provenance, expire and refresh", async (t) => {
  const f = await fixture(t), first = await f.read(); f.advance(1000);
  const hit = await f.read({ ...f.input, cache: { ...f.input.cache!, state: new StateStore(f.temp.root) } });
  assert.equal(f.calls(), 1); assert.equal(hit.rpcCallsTotal, 0);
  assert.deepEqual([hit.networks[0]!.attempts, hit.networks[0]!.methods, hit.networks[0]!.retried], [0, 0, []]);
  assert.deepEqual(hit.networks[0]!.rows, first.networks[0]!.rows);
  assert.equal(hit.networks[0]!.observedAt, first.networks[0]!.observedAt);
  assert.equal(hit.networks[0]!.block, "123"); assert.equal(hit.networks[0]!.cache!.ageMs, 1000);
  assert.equal(hit.networks[0]!.cache!.sourceRpc.rpcCalls, 1); assert.equal(hit.networks[0]!.cache!.sourceRpc.methods, 4);
  await f.read({ ...f.input, cache: { ...f.input.cache!, refresh: true } }); assert.equal(f.calls(), 2);
  f.advance(15_000); await f.read(); assert.equal(f.calls(), 3);
  const files = await readdir(join(f.temp.root, "portfolio-cache")); assert.equal(files.length, 1);
  assert.equal((await readFile(join(f.temp.root, "portfolio-cache", files[0]!), "utf8")).includes("https:"), false);
});
test("account, profile binding, dataset, asset and endpoint changes invalidate one stable slot", async (t) => {
  const f = await fixture(t); await f.read();
  const variants: AssetPortfolioInput[] = [
    { ...f.input, accounts: { ...accounts, evm: { kind: "account", address: "0x1111111111111111111111111111111111111111" } } },
    { ...f.input, cache: { ...f.input.cache!, profileIdentity: hashObject({ revision: 2 }) } },
    { ...f.input, inventory: { ...inventory, dataset: { ...inventory.dataset, sha256: "1".repeat(64) } } },
    { ...f.input, inventory: { ...inventory, assets: inventory.assets.map((v) => ({ ...v, decimals: v.decimals + 1 })) } },
    { ...f.input, endpoint: (chain) => portfolioEndpoint(chain, { APN_ETHEREUM_RPC_URL: "https://eth.example/secret" }) },
  ];
  for (const value of variants) { const result = await f.read(value); assert.equal(result.rpcCallsTotal, 1); }
  assert.equal(f.calls(), 6); assert.equal((await readdir(join(f.temp.root, "portfolio-cache"))).length, 1);
  await f.read({ ...f.input, cache: { ...f.input.cache!, profileHash: f.state.profileHash("ops") } }); assert.equal(f.calls(), 7);
});
test("failed refresh, partial and missing account results never return old cache or fabricate zeros", async (t) => {
  const f = await fixture(t); await f.read(); f.failure("unavailable");
  const refresh = { ...f.input, cache: { ...f.input.cache!, refresh: true } };
  const failed = await f.read(refresh); assert.equal(failed.networks[0]!.rows[0]!.atomic, null); assert.equal(failed.networks[0]!.cache, undefined);
  f.advance(15_000); await f.read(); await f.read(); assert.equal(f.calls(), 4);
  f.failure("partial"); await f.read(); await f.read(); assert.equal(f.calls(), 6);
  await f.read({ ...f.input, accounts: { ...accounts, evm: { kind: "none" } } }); assert.equal(f.calls(), 6);
});
test("corrupt records and future timestamps miss, while private-file modes and symlinks fail closed", async (t) => {
  const f = await fixture(t); await f.read(); const file = join(f.temp.root, "portfolio-cache", (await readdir(join(f.temp.root, "portfolio-cache")))[0]!);
  const valid = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, "{}", { mode: 0o600 }); await f.read(); assert.equal(f.calls(), 2);
  const future = { ...valid, capturedAt: "2026-10-05T01:00:00.000Z", expiresAt: "2026-10-05T01:00:15.000Z",
    capture: { ...valid.capture, observedAt: "2026-10-05T01:00:00.000Z" } }; delete future.digest; future.digest = hashObject(future);
  await writeFile(file, canonicalJson(future)); await f.read(); assert.equal(f.calls(), 3);
  const repaired = await f.read({ ...f.input, cache: { ...f.input.cache!, state: new StateStore(f.temp.root) } });
  assert.equal(f.calls(), 3); assert.equal(repaired.rpcCallsTotal, 0); assert.equal(repaired.networks[0]!.cache!.hit, true);
  assert.equal(repaired.networks[0]!.observedAt, f.clock.now().toISOString());
  await writeFile(file, canonicalJson(future));
  const refreshed = await f.read({ ...f.input, cache: { ...f.input.cache!, refresh: true } });
  assert.equal(f.calls(), 4); assert.equal(refreshed.networks[0]!.cache!.hit, false);
  const afterRefresh = await f.read({ ...f.input, cache: { ...f.input.cache!, state: new StateStore(f.temp.root) } });
  assert.equal(f.calls(), 4); assert.equal(afterRefresh.rpcCallsTotal, 0); assert.equal(afterRefresh.networks[0]!.cache!.hit, true);
  await chmod(file, 0o644); await assert.rejects(f.read(), { code: "APN_STATE_SECURITY" });
  await unlink(file); await symlink(join(f.temp.base, "foreign"), file); await assert.rejects(f.read(), { code: "APN_STATE_SECURITY" });
});
test("late older capture cannot replace a newer record under the slot lock", async (t) => {
  const f = await fixture(t); await f.read(); const file = join(f.temp.root, "portfolio-cache", (await readdir(join(f.temp.root, "portfolio-cache")))[0]!);
  const old = JSON.parse(await readFile(file, "utf8")); f.advance(1000); await f.read({ ...f.input, cache: { ...f.input.cache!, refresh: true } });
  const newer = await readFile(file, "utf8"); await new StateStore(f.temp.root).writePortfolioCache(old, f.clock); assert.equal(await readFile(file, "utf8"), newer);
  const sameInstant = { ...JSON.parse(newer), identity: "f".repeat(64) }; delete sameInstant.digest; sameInstant.digest = hashObject(sameInstant);
  await f.state.writePortfolioCache(sameInstant, f.clock);
  assert.equal((await f.state.loadPortfolioCache(old.slot))!.identity, sameInstant.identity, "equal-clock successful refresh can replace the result");
});
test("CLI refresh flag and MCP boolean bind with explicit schema and reject invalid types", () => {
  const tool = MCP_TOOLS.find((v) => v.name === "apn_wallet_portfolio")!;
  assert.deepEqual(bindArgv(["wallet", "portfolio", "--refresh"]).request, { command: "wallet.portfolio", profile: "default", refresh: true });
  assert.deepEqual(bindMcpInput(tool.command, { refresh: true }).request, { command: "wallet.portfolio", profile: "default", refresh: true });
  assert.equal((tool.inputSchema.properties.refresh as { type: string }).type, "boolean");
  assert.throws(() => bindMcpInput(tool.command, { refresh: "true" })); assert.throws(() => bindArgv(["wallet", "portfolio", "--refresh", "yes"]));
});


test("transfer preparation performs fresh rail reads and never touches portfolio cache methods", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  class NoCacheState extends StateStore {
    override async loadPortfolioCache(): Promise<never> { throw new Error("transfer accessed portfolio cache"); }
    override async writePortfolioCache(): Promise<never> { throw new Error("transfer wrote portfolio cache"); }
  }
  const rpc = new TestRpc();
  const core = new ApnCore({ state: new NoCacheState(temp.root), native: new CanonicalDirectTestNative(temp.root), rpc, clock: new TestClock(),
    policy: new TestProfilePolicy(), ids: { next: () => "00000000-0000-4000-8000-000000000001" } });
  await ensureWallet(core); assert.equal(typeof await prepareTransfer(core, "portfolio-isolated-transfer"), "string");
  assert.ok(rpc.balanceCalls > 0); assert.ok(rpc.nonceCalls > 0); assert.equal(rpc.submissions.length, 0);
});


test("cache writer samples the live clock after the secure slot read and rejects invalid clock values", async (t) => {
  const f = await fixture(t); await f.read();
  const file = join(f.temp.root, "portfolio-cache", (await readdir(join(f.temp.root, "portfolio-cache")))[0]!);
  const old = JSON.parse(await readFile(file, "utf8")); f.advance(1000);
  await f.read({ ...f.input, cache: { ...f.input.cache!, refresh: true } });
  const newer = await readFile(file, "utf8");
  let loaded = false;
  class CheckedReadStore extends StateStore {
    override async loadPortfolioCache(slot: string) {
      const record = await super.loadPortfolioCache(slot); loaded = true; return record;
    }
  }
  await new CheckedReadStore(f.temp.root).writePortfolioCache(old, { now: () => {
    assert.equal(loaded, true, "clock is sampled after the secure current-record read"); return f.clock.now();
  } });
  assert.equal(await readFile(file, "utf8"), newer);
  for (const invalid of [new Date(NaN), new Date(-1)]) {
    await assert.rejects(f.state.writePortfolioCache(old, { now: () => invalid }), { code: "APN_STATE_CORRUPT" });
    assert.equal(await readFile(file, "utf8"), newer);
  }
});
