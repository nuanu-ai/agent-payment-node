import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { createPermit2ProductionReadPort, type Permit2UsageReader } from "../../src/x402-permit2/read-port.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const;
const instant = new Date("2026-09-23T04:00:00.000Z");
const request = { payer, chainId: 43114 as const, token: asset.token,
  challengeHash: "a".repeat(64), offerHash: "b".repeat(64), amountAtomic: "10000",
  nonceBitmapWordIndex: "0", nowSeconds: Math.floor(instant.getTime() / 1000) };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address) view returns (uint256)"]);
const permitAbi = parseAbi(["function nonceBitmap(address,uint256) view returns (uint256)"]);

function refusal(reason: string) {
  return (error: unknown) => error instanceof ApnError && error.details?.reason === reason;
}

test("production read port refuses without an authenticated active owner admission before any network read", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  let rpcCalls = 0, httpCalls = 0;
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { call: async () => { rpcCalls++; throw new Error("unexpected RPC"); } },
    transport: { request: async () => { httpCalls++; throw new Error("unexpected HTTP"); } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
  assert.equal(rpcCalls, 0); assert.equal(httpCalls, 0);
});

test("active rail pin, account, amount cap and revocation are enforced before RPC", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const active = async (mechanism: { readonly provider: string; readonly reference: string }, cap = "20000") =>
    await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
      admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
        maximumPerTransferAtomic: cap, dailyLimitAtomic: "30000", mechanism }] });
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { call: async () => { throw new Error("RPC must be gated by owner policy"); } },
    transport: { request: async () => { throw new Error("HTTP must be gated by owner policy"); } } });
  await active({ provider: "other", reference: X402_PERMIT2_MECHANISM.reference });
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
  await active(X402_PERMIT2_MECHANISM, "9999");
  await assert.rejects(port.read(request), (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED");
  await active(X402_PERMIT2_MECHANISM);
  await assert.rejects(port.read({ ...request, payer: "0x1111111111111111111111111111111111111111" }),
    refusal("x402_permit2_read_binding"));
  await revokeDirectPolicy(temp.root, "owner", instant);
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
});

test("finalized chain identity and freshness fail closed without facilitator or transaction calls", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const calls: string[] = [];
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { call: async (method, params) => { calls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") { assert.equal(params[0], "finalized");
        return { number: "0x1", hash: `0x${"1".repeat(64)}`, timestamp: "0x1" }; }
      throw new Error(`Unexpected ${method}`);
    } },
    transport: { request: async () => { throw new Error("Facilitator must not be called"); } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_chain_evidence_required"));
  assert.deepEqual(calls, ["eth_chainId", "eth_getBlockByNumber"]);
});

async function scripted(t: test.TestContext, options: {
  readonly endOffsetSeconds?: number; readonly finalOffsetSeconds?: number; readonly blockAgeSeconds?: number; readonly status?: number;
  readonly kinds?: readonly unknown[]; readonly onSupported?: () => Promise<void>;
  readonly badProxyHash?: boolean; readonly changedBlockHash?: boolean;
  readonly localAccount?: () => Promise<`0x${string}`>;
  readonly usage?: Permit2UsageReader;
} = {}) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const calls: { method: string; params: readonly unknown[] }[] = [];
  let clockReads = 0, httpCalls = 0, activeCalls = 0;
  const startSeconds = Math.floor(instant.getTime() / 1000);
  const results = [word(20000n), word(10000n), asset.tokenDomainSeparator, word(9n), word(0n)];
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => { activeCalls++; return options.localAccount ? await options.localAccount() : payer; },
    usage: options.usage ?? new AssetUsageLedger(temp.root),
    now: () => { clockReads++; return new Date(instant.getTime() + (clockReads > 2 ?
      (options.finalOffsetSeconds ?? options.endOffsetSeconds ?? 0) * 1000 :
      clockReads > 1 ? (options.endOffsetSeconds ?? 0) * 1000 : 0)); },
    rpc: { call: async (method, params, signal) => {
      assert.equal(signal.aborted, false); calls.push({ method, params });
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") {
        assert.ok(params[0] === "finalized" || params[0] === "0x12");
        return { number: "0x12", hash: `0x${(options.changedBlockHash && params[0] === "0x12" ? "2" : "1").repeat(64)}`,
          timestamp: `0x${(startSeconds - (options.blockAgeSeconds ?? 5)).toString(16)}` };
      }
      if (method === "eth_call") {
        assert.equal(params[1], "0x12");
        const index = calls.filter(call => call.method === "eth_call").length - 1;
        const expected = [
          { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [payer] }) },
          { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [payer, PERMIT2_ADDRESS] }) },
          { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "DOMAIN_SEPARATOR" }) },
          { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "nonces", args: [payer] }) },
          { to: PERMIT2_ADDRESS, data: encodeFunctionData({ abi: permitAbi, functionName: "nonceBitmap", args: [payer, 0n] }) },
        ];
        assert.deepEqual(params[0], expected[index]);
        return results[index];
      }
      if (method === "eth_getProof") {
        assert.deepEqual(params.slice(1), [[], "0x12"]);
        const address = params[0];
        assert.ok(address === X402_EXACT_PERMIT2_PROXY || address === PERMIT2_ADDRESS);
        return { address, codeHash: address === PERMIT2_ADDRESS ? PERMIT2_CODE_HASH :
          options.badProxyHash ? `0x${"0".repeat(64)}` : asset.proxyCodeHash };
      }
      throw new Error(`Unexpected RPC method ${method}`);
    } },
    transport: { request: async (url, method, body) => {
      httpCalls++; assert.equal(url, "https://facilitator.payai.network/supported");
      assert.equal(method, "GET"); assert.equal(body, null);
      await options.onSupported?.();
      return { status: options.status ?? 200, body: JSON.stringify({ kinds: options.kinds ??
        [{ x402Version: 2, scheme: "exact", network: asset.chain }], extensions: ["eip2612GasSponsoring"] }) };
    } },
  });
  return { port, calls, stats: () => ({ httpCalls, activeCalls }) };
}

test("full adapter read binds pinned block, all call data, code hashes, facilitator and final owner", async (t) => {
  const fixture = await scripted(t);
  const read = await fixture.port.read(request);
  assert.equal(read.owner.account, payer);
  assert.equal(read.owner.maximumPerTransferAtomic, "20000");
  assert.equal(read.evidence.balanceAtomic, "20000");
  assert.equal(read.evidence.allowanceAtomic, "10000");
  assert.equal(read.evidence.eip2612Nonce, "9");
  assert.equal(read.evidence.nonceBitmapWord, word(0n));
  assert.equal(read.evidence.proxyCodeHash, asset.proxyCodeHash);
  assert.equal(read.evidence.facilitator.eip2612GasSponsoring, true);
  assert.deepEqual(fixture.calls.map(call => call.method), ["eth_chainId", "eth_getBlockByNumber",
    "eth_call", "eth_call", "eth_call", "eth_call", "eth_call", "eth_getProof", "eth_getProof", "eth_getBlockByNumber"]);
  assert.deepEqual(fixture.stats(), { httpCalls: 1, activeCalls: 2 });
  assert.equal(fixture.calls.some(call => /send|sign|estimate/iu.test(call.method)), false);
});

test("return-time block freshness and stale caller clock both refuse", async (t) => {
  const aged = await scripted(t, { blockAgeSeconds: 25, endOffsetSeconds: 7 });
  await assert.rejects(aged.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  assert.equal(aged.stats().httpCalls, 1);
  const late = await scripted(t, { blockAgeSeconds: 25, endOffsetSeconds: 0, finalOffsetSeconds: 7 });
  await assert.rejects(late.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  const stale = await scripted(t);
  await assert.rejects(stale.port.read({ ...request, nowSeconds: request.nowSeconds - 40 }), refusal("x402_permit2_read_clock"));
  assert.equal(stale.calls.length, 0);
});

test("facilitator 429 or absent exact kind refuses after pinned reads", async (t) => {
  for (const options of [{ status: 429 }, { kinds: [] }]) {
    const fixture = await scripted(t, options);
    await assert.rejects(fixture.port.read(request), refusal("x402_permit2_facilitator_unavailable"));
    assert.equal(fixture.calls.length, 10);
    assert.equal(fixture.stats().httpCalls, 1);
  }
});

test("changed code hash or pinned block hash refuses before facilitator", async (t) => {
  for (const options of [{ badProxyHash: true }, { changedBlockHash: true }]) {
    const fixture = await scripted(t, options);
    await assert.rejects(fixture.port.read(request));
    assert.equal(fixture.stats().httpCalls, 0);
    assert.ok(fixture.calls.length <= 10);
  }
});

test("final owner account and usage changes refuse after observation", async (t) => {
  let accountReads = 0;
  const switched = await scripted(t, { localAccount: async () => (++accountReads === 1 ? payer :
    "0x1111111111111111111111111111111111111111") });
  await assert.rejects(switched.port.read(request), refusal("x402_permit2_owner_admission_required"));
  let usageReads = 0;
  const ledger: Permit2UsageReader = { usage: async () => ({ amountAtomic: (++usageReads === 1 ? "0" : "1") }) };
  const changed = await scripted(t, { usage: ledger });
  await assert.rejects(changed.port.read(request), refusal("x402_permit2_owner_admission_required"));
});

test("hung RPC is aborted once and does not fan out", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  let calls = 0, aborted = false;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { call: async (_method, _params, signal) => { calls++; started();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      throw new Error("aborted");
    } }, transport: { request: async () => { throw new Error("no HTTP"); } } });
  const first = port.read(request);
  await entered;
  await assert.rejects(port.read(request), refusal("x402_permit2_read_busy"));
  await assert.rejects(first);
  assert.equal(calls, 1); assert.equal(aborted, true);
});
