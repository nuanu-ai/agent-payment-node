import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseAbi } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { createPermit2ProductionReadPort, type Permit2UsageReader } from "../../src/x402-permit2/read-port.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const;
const instant = new Date("2026-09-23T04:00:00.000Z");
// The asset as selection admits it: the owner row's identity, chain facts not read yet.
const selected = { ...asset, networkName: "Avalanche C-Chain", tokenDomainSeparator: null };
const request = { payer, asset: selected,
  challengeHash: "a".repeat(64), offerHash: "b".repeat(64), amountAtomic: "10000",
  nonceBitmapWordIndex: "0", nowSeconds: Math.floor(instant.getTime() / 1000), sellerSponsorsEip2612: true,
  payTo: "0x2222222222222222222222222222222222222222" as const };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address) view returns (uint256)"]);
const permitAbi = parseAbi(["function nonceBitmap(address,uint256) view returns (uint256)"]);

function refusal(reason: string) {
  return (error: unknown) => error instanceof ApnError && error.details?.reason === reason;
}

const proxyCode = readFileSync("tests/fixtures/x402-permit2/original-proxy-runtime.hex", "utf8").trim() as `0x${string}`;
const permit2Code = readFileSync("tests/fixtures/x402-permit2/avalanche-permit2-runtime.hex", "utf8").trim() as `0x${string}`;
type Call = { readonly method: string; readonly params: readonly unknown[] };
const unexpected = { batch: async (): Promise<never> => { throw new Error("RPC must be gated by owner policy"); } };

test("production read port refuses without an authenticated active owner admission before any network read", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  let rpcCalls = 0;
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { batch: async () => { rpcCalls++; throw new Error("unexpected RPC"); } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
  assert.equal(rpcCalls, 0);
});

test("active rail pin, account, amount cap and revocation are enforced before RPC", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const active = async (mechanism: { readonly provider: string; readonly reference: string }, cap = "20000") =>
    await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
      admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
        maximumPerTransferAtomic: cap, dailyLimitAtomic: "30000", mechanism }] });
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant, rpc: unexpected });
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

test("latest-block chain identity and freshness fail closed after one POST", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const posts: string[][] = [];
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: { batch: async (calls) => { posts.push(calls.map(call => call.method));
      return calls.map(({ method, params }) => {
        if (method === "eth_chainId") return "0xa86a";
        assert.equal(method, "eth_getBlockByNumber"); assert.equal(params[0], "latest");
        return { number: "0x1", hash: `0x${"1".repeat(64)}`, timestamp: "0x1" };
      });
    } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_chain_evidence_required"));
  assert.deepEqual(posts, [["eth_chainId", "eth_getBlockByNumber"]]);
});

async function scripted(t: test.TestContext, options: {
  readonly endOffsetSeconds?: number; readonly finalOffsetSeconds?: number; readonly blockAgeSeconds?: number;
  readonly badProxyCode?: boolean; readonly notCanonical?: boolean; readonly allowance?: bigint; readonly chain?: string;
  readonly permit2Code?: `0x${string}`; readonly domain?: string;
  readonly localAccount?: () => Promise<`0x${string}`>;
  readonly usage?: Permit2UsageReader;
} = {}) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const posts: Call[][] = [];
  let clockReads = 0, activeCalls = 0;
  const startSeconds = Math.floor(instant.getTime() / 1000);
  const hash = `0x${"1".repeat(64)}`, pinned = { blockHash: hash, requireCanonical: true };
  const expected = [
    { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [payer] }) },
    { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [payer, PERMIT2_ADDRESS] }) },
    { to: PERMIT2_ADDRESS, data: encodeFunctionData({ abi: permitAbi, functionName: "nonceBitmap", args: [payer, 0n] }) },
  ];
  const sponsored = [
    { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "DOMAIN_SEPARATOR" }) },
    { to: asset.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "nonces", args: [payer] }) },
  ];
  const results = [word(20000n), word(options.allowance ?? 10000n), word(0n)];
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => { activeCalls++; return options.localAccount ? await options.localAccount() : payer; },
    usage: options.usage ?? new AssetUsageLedger(temp.root),
    now: () => { clockReads++; return new Date(instant.getTime() + (clockReads > 2 ?
      (options.finalOffsetSeconds ?? options.endOffsetSeconds ?? 0) * 1000 :
      clockReads > 1 ? (options.endOffsetSeconds ?? 0) * 1000 : 0)); },
    rpc: { batch: async (calls, signal) => {
      assert.equal(signal.aborted, false); posts.push([...calls]);
      if (posts.length === 2 && options.notCanonical) throw new ApnError("APN_RPC_PROTOCOL", "header not found or not canonical");
      return calls.map(({ method, params }, index) => {
        if (method === "eth_chainId") return options.chain ?? "0xa86a";
        if (method === "eth_getBlockByNumber") {
          assert.equal(params[0], "latest");
          return { number: "0x12", hash, timestamp: `0x${(startSeconds - (options.blockAgeSeconds ?? 5)).toString(16)}` };
        }
        assert.deepEqual(params[1], pinned, "every state read is pinned to the latest block's hash");
        if (method === "eth_getCode") {
          assert.equal(params[0], index === 3 ? X402_EXACT_PERMIT2_PROXY : PERMIT2_ADDRESS);
          return index === 3 ? (options.badProxyCode ? "0x6000" : proxyCode) : options.permit2Code ?? permit2Code;
        }
        assert.equal(method, "eth_call");
        if (posts.length === 3) { assert.deepEqual(params[0], sponsored[index]); return index === 0 ? options.domain ?? asset.tokenDomainSeparator : word(9n); }
        assert.deepEqual(params[0], expected[index]);
        return results[index];
      });
    } },
  });
  return { port, posts, stats: () => ({ activeCalls }) };
}

test("full adapter read: two POSTs bind the pinned block, all call data, immutable code and the final owner", async (t) => {
  const fixture = await scripted(t);
  const read = await fixture.port.readChecked(request);
  assert.equal(read.owner.account, payer);
  assert.equal(read.owner.maximumPerTransferAtomic, "20000");
  assert.equal(read.evidence.balanceAtomic, "20000");
  assert.equal(read.evidence.allowanceAtomic, "10000");
  assert.equal(read.evidence.eip2612Nonce, null, "an allowance that covers the price needs no token permit read");
  assert.equal(read.evidence.tokenDomainSeparator, null);
  assert.equal(read.evidence.nonceBitmapWord, word(0n));
  assert.equal(read.evidence.proxyCodeHash, asset.proxyCodeHash);
  assert.deepEqual(read.asset, { ...selected, symbol: "USDT", decimals: 6 }, "token identity is the owner's row");
  assert.equal(read.evidence.facilitator.eip2612GasSponsoring, true, "sponsorship follows the seller's own 402 declaration");
  assert.equal(read.checkpoint.facilitatorSupportedDigest, request.challengeHash, "no PayAI /supported read; the seller challenge is the source");
  assert.deepEqual(fixture.posts.map(post => post.map(call => call.method)), [["eth_chainId", "eth_getBlockByNumber"],
    ["eth_call", "eth_call", "eth_call", "eth_getCode", "eth_getCode"]], "2 POSTs (was 10 paced POSTs and a facilitator GET)");
  assert.deepEqual(fixture.stats(), { activeCalls: 2 });
  assert.equal(fixture.posts.flat().some(call => /send|sign|estimate|getProof/iu.test(call.method)), false);
});

test("return-time block freshness and stale caller clock both refuse", async (t) => {
  const aged = await scripted(t, { blockAgeSeconds: 25, endOffsetSeconds: 7 });
  await assert.rejects(aged.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  const late = await scripted(t, { blockAgeSeconds: 25, endOffsetSeconds: 0, finalOffsetSeconds: 7 });
  await assert.rejects(late.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  const stale = await scripted(t);
  await assert.rejects(stale.port.read({ ...request, nowSeconds: request.nowSeconds - 40 }), refusal("x402_permit2_read_clock"));
  assert.equal(stale.posts.length, 0);
});

test("changed proxy code or a pinned read the endpoint cannot serve canonically refuses", async (t) => {
  const changed = await scripted(t, { badProxyCode: true });
  await assert.rejects(changed.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  const refused = await scripted(t, { notCanonical: true });
  await assert.rejects(refused.port.read(request), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_PROTOCOL");
  assert.equal(refused.posts.length, 2);
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
    rpc: { batch: async (_calls, signal) => { calls++; started();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      throw new Error("aborted");
    } } });
  const first = port.read(request);
  await entered;
  await assert.rejects(port.read(request), refusal("x402_permit2_read_busy"));
  await assert.rejects(first);
  assert.equal(calls, 1); assert.equal(aborted, true);
});

test("a short allowance under seller sponsorship reads the token domain in a third pinned POST and proves it", async (t) => {
  const sponsored = await scripted(t, { allowance: 0n });
  const read = await sponsored.port.readChecked(request);
  assert.equal(read.evidence.eip2612Nonce, "9"); assert.equal(read.evidence.tokenDomainSeparator, asset.tokenDomainSeparator);
  assert.equal(read.asset.tokenDomainSeparator, asset.tokenDomainSeparator);
  assert.deepEqual(sponsored.posts.map(post => post.length), [2, 5, 2]);
  const wrong = await scripted(t, { allowance: 0n, domain: word(1n) });
  await assert.rejects(wrong.port.read(request), refusal("x402_permit2_token_domain_mismatch"));
});

test("Permit2 runtime must be the canonical template with this chain's own immutables; the RPC must serve the admitted chain", async (t) => {
  // The Avalanche runtime presented to Base keeps Avalanche's cached chain id and domain separator.
  const foreign = await scripted(t, { permit2Code: permit2Code.replace("a86a03611b69577f", "a86b03611b69577f") as `0x${string}` });
  await assert.rejects(foreign.port.read(request), refusal("x402_permit2_chain_evidence_required"));
  const other = await scripted(t, { chain: "0x2105" });
  await assert.rejects(other.port.read(request), (error: unknown) => error instanceof ApnError && error.code === "APN_CHAIN_MISMATCH" &&
    error.details?.chain === "eip155:43114");
});
