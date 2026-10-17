/**
 * SYNTHETIC end-to-end (OWNR-18/19, QA X402-MERCHANT-001): any local profile pays any x402 transfer-proof merchant through
 * the real CLI command path (argv parse, bind, runtime, service, custody). Keys are generated in a temporary state and sign
 * for real; the merchant and the MegaETH RPC are in-process fakes; nothing leaves the machine.
 *
 * A second, non-USDm asset exists only in this test process: the data-only pin registry is extended before any merchant
 * module loads, exactly as a new registry entry would be added in code.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, hashDomain, keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";

const SYND = Object.freeze({ chain: "eip155:4326", networkName: "MegaETH", token: getAddress("0x5e1d5e1d5e1d5e1d5e1d5e1d5e1d5e1d5e1d5e1d"),
  name: "Synthetic Dollar", symbol: "SYND", decimals: 6, evidence: "tests/core/merchant-any-merchant.test.ts (synthetic)" });
const realPins = await import("../../src/x402-merchant/asset-pins.js");
mock.module("../../src/x402-merchant/asset-pins.js", { namedExports: { ...realPins, MERCHANT_ASSET_PINS: Object.freeze([...realPins.MERCHANT_ASSET_PINS, SYND]) } });
const { runCli } = await import("../../src/cli.js");
const { TtyAllowlistPolicyApproval } = await import("../../src/allowlist-policy-activation.js");
const { BridgeHttps } = await import("../../src/lifi/https.js");
const { MEGA_FEE_ORACLE } = await import("../../src/x402-merchant/mega-fee.js");
const { merchantAssetMechanism, LEGACY_MERCHANT_MECHANISM } = await import("../../src/x402-merchant/pins.js");
type HttpObservation = import("../../src/x402-model.js").HttpObservation;
type Pin = { readonly token: string; readonly name: string; readonly symbol: string; readonly decimals: number; readonly deployment?: { readonly implementation: string; readonly domainVersion: string } };

const BLOCK = `0x${"a".repeat(64)}` as Hex, PARENT = `0x${"d".repeat(64)}` as Hex, START = 0x100000000000000n, OTHER = "0x9999999999999999999999999999999999999999";
const codes = await (async () => {
  const code = JSON.parse(await readFile("tests/core/merchant-code-fixture.json", "utf8")) as { responses: { result: string }[] };
  const oracle = JSON.parse(await readFile("tests/core/merchant-fee-fixtures/canonical-oracle.json", "utf8")) as { id: string; result: string }[];
  const implementation = JSON.parse(await readFile("tests/core/merchant-fee-fixtures/oracle-implementation.json", "utf8")) as { id: string; result: string }[];
  return { token: code.responses[0]!.result, impl: code.responses[1]!.result, oracle: oracle.find((x) => x.id === "3")!.result, oracleImpl: implementation.find((x) => x.id === "0")!.result };
})();
interface Merchant { readonly url: string; readonly pin: Pin; readonly payee: string; readonly amount: string; readonly row?: Record<string, unknown>; readonly extraRows?: readonly Record<string, unknown>[] }
const USDM_MERCHANT: Merchant = { url: "https://x402engine.app/api/crypto/price?ids=bitcoin", pin: realPins.MEGAETH_USDM, payee: getAddress("0x7dd5Be069f2d2eAd75eC7C3423B116fF043c2629"), amount: "1000000000000000" };
const SYND_MERCHANT: Merchant = { url: "https://shop.example/reports/42", pin: SYND, payee: getAddress("0x2222222222222222222222222222222222222222"), amount: "2500000" };

/** MegaETH: serves the exact transaction the payer signed, at a finalized block, with its Transfer log and full fee. */
class Chain {
  raw: Hex | null = null; sends = 0;
  constructor(private readonly m: Merchant, readonly payer: () => string) {}
  private block(full: boolean) {
    return { number: "0x10", hash: BLOCK, parentHash: PARENT, stateRoot: BLOCK, transactionsRoot: BLOCK, receiptsRoot: BLOCK, sha3Uncles: BLOCK, logsBloom: `0x${"0".repeat(512)}`,
      nonce: "0x0000000000000000", miner: OTHER, extraData: "0x", timestamp: "0x100", gasLimit: "0x100000", gasUsed: "0x186a0", difficulty: "0x0", baseFeePerGas: "0x1",
      ...(full ? { transactions: this.raw === null ? [] : [this.tx()] } : {}) };
  }
  private tx() {
    const t = parseTransaction(this.raw!), q = (v: bigint | number | undefined) => `0x${BigInt(v ?? 0).toString(16)}`;
    return { hash: keccak256(this.raw!), blockHash: BLOCK, blockNumber: "0x10", transactionIndex: "0x0", type: "0x2", accessList: [], from: this.payer(), to: t.to, input: t.data,
      value: q(t.value), nonce: q(t.nonce), chainId: "0x10e6", gas: q(t.gas), maxFeePerGas: q(t.maxFeePerGas), maxPriorityFeePerGas: q(t.maxPriorityFeePerGas) };
  }
  private receipt() {
    const hash = keccak256(this.raw!);
    return { transactionHash: hash, blockNumber: "0x10", blockHash: BLOCK, status: "0x1", type: "0x2", transactionIndex: "0x0", gasUsed: "0x186a0", effectiveGasPrice: "0x2", l1Fee: "0x64",
      from: this.payer(), to: this.m.pin.token, logs: [{ address: this.m.pin.token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: this.payer() as Hex, to: this.m.payee as Hex } }),
        data: encodeAbiParameters([{ type: "uint256" }], [BigInt(this.m.amount)]), transactionHash: hash, blockHash: BLOCK, blockNumber: "0x10", transactionIndex: "0x0", logIndex: "0x0", removed: false }] };
  }
  async value(method: string, p: readonly unknown[]): Promise<unknown> {
    const to = (i: number) => String(p[i]).toLowerCase(), d = this.m.pin.deployment;
    if (method === "eth_chainId") return "0x10e6";
    if (method === "eth_getBlockByNumber") return p[0] === "0xf" ? { ...this.block(false), number: "0xf", hash: PARENT } : this.block(p[1] === true);
    if (method === "eth_getCode") return to(0) === MEGA_FEE_ORACLE.address.toLowerCase() ? codes.oracle : to(0) === MEGA_FEE_ORACLE.implementation.toLowerCase() ? codes.oracleImpl
      : to(0) === this.payer().toLowerCase() ? "0x" : d !== undefined && to(0) === d.implementation.toLowerCase() ? codes.impl : to(0) === this.m.pin.token.toLowerCase() && d !== undefined ? codes.token : "0x6000";
    if (method === "eth_getStorageAt") return `0x${(to(0) === MEGA_FEE_ORACLE.address.toLowerCase() ? MEGA_FEE_ORACLE.implementation : d!.implementation).slice(2).toLowerCase().padStart(64, "0")}`;
    if (method === "eth_getBalance") return typeof p[1] === "object" && (p[1] as { blockHash: string }).blockHash === BLOCK && this.raw !== null ? `0x${(START - 200_100n).toString(16)}` : `0x${START.toString(16)}`;
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_call" && String((p[0] as { to: string }).to).toLowerCase() === MEGA_FEE_ORACLE.address.toLowerCase()) {
      const s = (p[0] as { data: string }).data.slice(0, 10);
      return s === "0xf1c7a58b" ? encodeAbiParameters([{ type: "uint256" }], [100n]) : s === "0x275aedd2" ? encodeAbiParameters([{ type: "uint256" }], [0n])
        : s === "0x54fd4d50" ? encodeAbiParameters([{ type: "string" }], ["1.4.0"]) : encodeAbiParameters([{ type: "bool" }], [true]);
    }
    if (method === "eth_call") {
      const s = (p[0] as { data: string }).data.slice(0, 10), pin = this.m.pin;
      if (s === "0x06fdde03") return encodeAbiParameters([{ type: "string" }], [pin.name]);
      if (s === "0x95d89b41") return encodeAbiParameters([{ type: "string" }], [pin.symbol]);
      if (s === "0x313ce567") return encodeAbiParameters([{ type: "uint8" }], [pin.decimals]);
      if (s === "0x3644e515") return hashDomain({ types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] },
        domain: { name: pin.name, version: pin.deployment!.domainVersion, chainId: 4326n, verifyingContract: pin.token as Hex } });
      return encodeAbiParameters([{ type: "uint256" }], [10n ** 24n]);
    }
    if (method === "eth_sendRawTransaction") { this.sends++; this.raw = p[0] as Hex; return keccak256(this.raw); }
    if (method === "eth_getTransactionReceipt") return this.raw !== null && p[0] === keccak256(this.raw) ? this.receipt() : null;
    if (method === "eth_getTransactionByHash") return this.raw !== null && p[0] === keccak256(this.raw) ? this.tx() : null;
    throw new Error(`unexpected ${method}`);
  }
}

function challenge(m: Merchant, row = m.row ?? {}) {
  return { x402Version: 2, error: "Payment required", resource: { url: m.url, description: "Paid resource", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: m.payee, maxTimeoutSeconds: 300 },
      { scheme: "exact", network: "eip155:4326", amount: m.amount, asset: m.pin.token, payTo: m.payee, maxTimeoutSeconds: 600, ...row }, ...(m.extraRows ?? [])] };
}
function observation(m: Merchant, status: number, body = "{}", type = "application/json"): HttpObservation {
  const now = new Date().toISOString();
  return { status, rawHeaderPairs: status === 402 ? [["payment-required", Buffer.from(JSON.stringify(challenge(m))).toString("base64")]] : [["content-type", type]],
    bodyBytes: Buffer.from(body), finalUrl: m.url, observedOrigin: new URL(m.url).origin, dnsAddresses: ["1.1.1.1"], selectedAddress: "1.1.1.1", startedAt: now, observedAt: now,
    safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 } };
}

async function setup(t: test.TestContext, m: Merchant, profile: string, admission: (payer: string) => { mechanism?: unknown; recipients?: readonly string[] } = () => ({})) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "apn-merchant-")), root = join(base, "state"); t.after(() => rm(base, { recursive: true, force: true }));
  const wrappingSecret = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const ensured = await runCli(["wallet", "ensure", "--profile", profile], {}, { stateRoot: root, wrappingSecret });
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error));
  const payer = (ensured.data as { address: string }).address, extra = admission(payer), now = Date.now();
  const mechanism = extra.mechanism ?? merchantAssetMechanism({ chain: "eip155:4326", token: m.pin.token });
  const file = join(base, "policy.json");
  await writeFile(file, JSON.stringify({ schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "synthetic.merchant.1", accounts: { evm: payer },
    effectiveAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), admissions: [
      { chain: "eip155:4326", kind: "token", identifier: m.pin.token, rail: "x402", maximumPerTransferAtomic: m.amount, dailyLimitAtomic: m.amount, mechanism,
        ...(extra.recipients === undefined ? {} : { recipients: extra.recipients }) },
      { chain: "eip155:4326", kind: "native", rail: "x402", maximumPerTransferAtomic: "1000000000000", dailyLimitAtomic: "1000000000000", mechanism }] }), { mode: 0o600 });
  const staged = await runCli(["allowlist", "policy", "stage", "--profile", profile, "--file", file], {}, { stateRoot: root });
  assert.equal(staged.ok, true, JSON.stringify(staged.error));
  let screen = "";
  const allowlistPolicyApproval = new TtyAllowlistPolicyApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 11, write: async (s: string) => { screen += s; },
    read: async function* () { yield Buffer.from(`${[...screen.matchAll(/Type ([a-f0-9]{6})/gu)].at(-1)![1]!}\n`); }, close: async () => {} }) });
  const activated = await runCli(["allowlist", "policy", "activate", "--profile", profile, "--revision", "1"], {}, { stateRoot: root, allowlistPolicyApproval });
  assert.equal(activated.ok, true, JSON.stringify(activated.error));
  const chain = new Chain(m, () => payer), gets: string[] = [], proofs: string[] = [];
  t.mock.method(BridgeHttps.prototype, "request", async (_url: string, _verb: string, body?: string, _max?: number, _code?: string, beforeWire?: () => void) => {
    const request = JSON.parse(body!) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const rows = Array.isArray(request) ? request : [request];
    if (rows.some((row) => row.method === "eth_sendRawTransaction")) beforeWire?.();
    const results = await Promise.all(rows.map(async (row) => ({ jsonrpc: "2.0", id: row.id, result: await chain.value(row.method, row.params) })));
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? results : results[0]) };
  });
  let consent = "", phrase = "";
  const options = { stateRoot: root, wrappingSecret,
    http: { get: async (input: { url: string; paymentSignature?: string }) => { gets.push(input.url);
      if (input.paymentSignature === undefined) return observation(m, 402);
      proofs.push(input.paymentSignature); return observation(m, 200, JSON.stringify({ report: 42 })); } },
    merchantTtyOptions: { isTerminal: () => true, openTerminal: async () => ({ fd: 1, write: async (text: string) => { consent += text; phrase = /Type ([a-f0-9]{8})/u.exec(text)?.[1] ?? phrase; },
      read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => {} }) } };
  const cli = (args: readonly string[]) => runCli(["x402", "merchant", ...args], {}, options as never);
  return { payer, chain, cli, gets, proofs, consent: () => consent,
    prepare: (key: string, extra: readonly string[] = []) => cli(["prepare", "--profile", profile, "--url", m.url, ...extra, "--max-native-fee-wei", "1000000000000", "--idempotency-key", key]) };
}
const reason = (r: { readonly error: { readonly details?: Readonly<Record<string, unknown>> } | null }) => r.error?.details?.reason;

for (const [label, m] of [["x402engine USDm merchant (X402-MERCHANT-001)", USDM_MERCHANT], ["synthetic SYND merchant with a non-USDm asset", SYND_MERCHANT]] as const) {
  test(`${label}: a generated non-owner profile prepares, approves in the foreground, pays once and receives delivery`, async (t) => {
    const f = await setup(t, m, `buyer-${m.pin.symbol.toLowerCase()}`);
    const prepared = await f.prepare("any-merchant-0001");
    assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    const op = prepared.data as { operationId: string; state: string; url: string; payer: string; payee: string; amountAtomic: string; asset: { token: string; symbol: string }; provider: { id: string; reference: string } };
    assert.deepEqual([op.state, op.url, op.payer, op.payee, op.amountAtomic, op.asset.token], ["prepared", m.url, f.payer, m.payee, m.amount, m.pin.token]);
    assert.deepEqual(op.provider.id, "x402-erc20-transfer-proof"); assert.equal(op.provider.reference, `eip155:4326/${m.pin.token}`);
    const approved = await f.cli(["approve", "--operation", op.operationId]);
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const done = approved.data as { state: string; paymentFinalized: boolean; result: { mediaType: string; json: unknown } };
    assert.equal(done.state, "delivered"); assert.equal(done.paymentFinalized, true); assert.deepEqual(done.result, { mediaType: "application/json", json: { report: 42 } });
    assert.equal(f.chain.sends, 1); assert.equal(await recoverTransactionAddress({ serializedTransaction: f.chain.raw as `0x02${string}` }), f.payer);
    const signed = parseTransaction(f.chain.raw!);
    assert.equal(signed.to?.toLowerCase(), m.pin.token.toLowerCase());
    assert.match(f.consent(), new RegExp(`Merchant payee: ${m.payee}`, "u")); assert.match(f.consent(), new RegExp(`local payer: ${f.payer}`, "u"));
    assert.match(f.consent(), /Merchant payment window: 600 seconds from each challenge read/u);
    assert.equal(f.proofs.length, 1);
    assert.deepEqual(JSON.parse(Buffer.from(f.proofs[0]!, "base64").toString()).payload, { txHash: keccak256(f.chain.raw!) });
    // The same request is idempotent; a second approve cannot pay again.
    assert.equal(((await f.prepare("any-merchant-0001")).data as { operationId: string }).operationId, op.operationId);
    assert.equal((await f.cli(["approve", "--operation", op.operationId])).ok, false); assert.equal(f.chain.sends, 1);
  });
}

test("an owner recipient pin on the token admission must list the merchant payee (OD-1)", async (t) => {
  const refused = await setup(t, SYND_MERCHANT, "buyer-pinned-away", () => ({ recipients: [OTHER] }));
  const result = await refused.prepare("pinned-away-0001");
  assert.equal(result.error?.code, "APN_ALLOWLIST_REFUSED"); assert.equal(reason(result), "allowlist_recipient_not_admitted");
  assert.equal(refused.chain.sends, 0); assert.equal(refused.proofs.length, 0);
  const admitted = await setup(t, SYND_MERCHANT, "buyer-pinned-payee", () => ({ recipients: [OTHER, SYND_MERCHANT.payee] }));
  const prepared = await admitted.prepare("pinned-payee-0001");
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error)); assert.equal((prepared.data as { payee: string }).payee, SYND_MERCHANT.payee);
});

test("the legacy x402engine reference admits only old operations; a new prepare needs the asset's own reference", async (t) => {
  const f = await setup(t, USDM_MERCHANT, "buyer-legacy-policy", () => ({ mechanism: LEGACY_MERCHANT_MECHANISM }));
  const result = await f.prepare("legacy-policy-0001");
  assert.equal(reason(result), "merchant_mechanism_pin_required"); assert.equal(f.chain.sends, 0);
});

test("a challenge whose only payable row names an unpinned asset is refused before any admission or chain read", async (t) => {
  // The owner admitted SYND; the merchant asks for an asset no registry entry pins.
  const unpinned: Merchant = { ...SYND_MERCHANT, row: { asset: getAddress("0x7777777777777777777777777777777777777777") } };
  const f = await setup(t, unpinned, "buyer-unpinned");
  assert.equal(reason(await f.prepare("unpinned-0001")), "merchant_exact_requirement_missing_or_ambiguous");
  assert.equal(f.chain.sends, 0);
});

test("a merchant offering several pinned assets: --asset chooses, and without it the refusal lists the offered assets", async (t) => {
  const both: Merchant = { ...SYND_MERCHANT, extraRows: [{ scheme: "exact", network: "eip155:4326", amount: USDM_MERCHANT.amount, asset: realPins.MEGAETH_USDM.token, payTo: SYND_MERCHANT.payee, maxTimeoutSeconds: 60 }] };
  const f = await setup(t, both, "buyer-two-assets");
  const unchosen = await f.prepare("two-assets-0001");
  assert.equal(unchosen.error?.code, "APN_INVALID_INPUT"); assert.equal(reason(unchosen), "merchant_asset_choice_required");
  assert.match(String(unchosen.error?.message), new RegExp(`SYND ${SYND.token}.*USDm ${realPins.MEGAETH_USDM.token}`, "u"));
  assert.equal(reason(await f.prepare("two-assets-0002", ["--asset", "0x7777777777777777777777777777777777777777"])), "merchant_asset_not_pinned");
  const chosen = await f.prepare("two-assets-0003", ["--asset", SYND.token.toLowerCase()]);
  assert.equal(chosen.ok, true, JSON.stringify(chosen.error));
  const op = chosen.data as { asset: { token: string; symbol: string }; amountAtomic: string };
  assert.deepEqual([op.asset.token, op.asset.symbol, op.amountAtomic], [SYND.token, "SYND", SYND_MERCHANT.amount]);
  assert.equal(f.chain.sends, 0);
});
