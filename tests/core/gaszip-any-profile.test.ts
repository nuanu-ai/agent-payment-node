/**
 * SYNTHETIC: both GasZip direct routes (Base ETH to Mega ETH, Base ETH to Sei SEI) run for any local profile through the
 * real CLI command path (argv parse, bind, core dispatch, service). Generated keys in a temporary state; no live RPC,
 * no provider request, no funds. The owner's admission (exact mechanism, caps, optional recipient pin) is the only gate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, parseTransaction, type Hex } from "viem";
import { TtyAllowlistPolicyApproval } from "../../src/allowlist-policy-activation.js";
import { runCli } from "../../src/cli.js";
import { StateStore } from "../../src/state.js";
import { MEGA_FUNDING } from "../../src/lifi/mega-gaszip-contract.js";
import { MegaFundingService } from "../../src/lifi/mega-gaszip-service.js";
import { SEI_FUNDING } from "../../src/lifi/sei-gaszip-contract.js";
import { SeiFundingService } from "../../src/lifi/sei-gaszip-service.js";
import { temporaryState } from "./helpers.js";

const h = (v: bigint): Hex => `0x${v.toString(16)}`;
const SOURCE_BLOCK = `0x${"1".repeat(64)}` as Hex, DEST_BLOCK = `0x${"2".repeat(64)}` as Hex, DEST_HASH = `0x${"4".repeat(64)}` as Hex;
const SIGNER = "0x2222222222222222222222222222222222222222", OTHER = "0x5555555555555555555555555555555555555555";
interface Route {
  readonly name: "mega" | "sei"; readonly chain: bigint; readonly short: string; readonly data: Hex; readonly target: string;
  readonly mechanism: { readonly provider: string; readonly reference: string }; readonly output: string;
  readonly service: typeof MegaFundingService | typeof SeiFundingService;
}
const ROUTES: readonly Route[] = [
  { name: "mega", chain: 4326n, short: "514", data: MEGA_FUNDING.data, target: MEGA_FUNDING.target, mechanism: MEGA_FUNDING.mechanism, output: "6800000000000", service: MegaFundingService },
  { name: "sei", chain: 1329n, short: "246", data: SEI_FUNDING.data, target: SEI_FUNDING.target, mechanism: SEI_FUNDING.mechanism, output: "258965737575087424", service: SeiFundingService },
];
const OTHER_ROUTE = (route: Route): Route => ROUTES.find((candidate) => candidate.name !== route.name)!;

/** Base source chain: plans, accepts one send and serves the exact sent transaction at a safe receipt. */
class Source {
  raw: Hex | null = null; sends = 0;
  constructor(private readonly route: Route, private readonly owner: () => string) {}
  async call(m: string, p: readonly unknown[], guard?: () => void): Promise<unknown> {
    if (m === "eth_chainId") return h(8453n);
    if (m === "eth_getBlockByNumber") return { hash: SOURCE_BLOCK, number: h(100n), baseFeePerGas: h(5_000_000n) };
    if (m === "eth_getCode") return "0x";
    if (m === "eth_getBalance") return h(100_000_000_000_000n);
    if (m === "eth_getTransactionCount") return "0x0";
    if (m === "eth_estimateGas") { assert.equal((p[0] as { data: string }).data, this.route.data); return h(21_256n); }
    if (m === "eth_call") return `0x${"0".repeat(64)}`;
    if (m === "eth_sendRawTransaction") { guard!(); guard!(); this.sends++; this.raw = p[0] as Hex; return keccak256(this.raw); }
    if (m === "eth_getTransactionByHash" || m === "eth_getTransactionReceipt") {
      if (this.raw === null) return null;
      const tx = parseTransaction(this.raw), hash = keccak256(this.raw);
      const common = { hash, transactionHash: hash, from: this.owner(), to: this.route.target, blockHash: SOURCE_BLOCK, blockNumber: h(100n) };
      return m === "eth_getTransactionByHash"
        ? { ...common, chainId: h(8453n), input: this.route.data, value: h(tx.value!), nonce: h(BigInt(tx.nonce!)), gas: h(tx.gas!),
          maxFeePerGas: h(tx.maxFeePerGas!), maxPriorityFeePerGas: h(tx.maxPriorityFeePerGas!) }
        : { ...common, status: "0x1", gasUsed: h(21_256n), effectiveGasPrice: h(6_000_000n), l1Fee: "0x0" };
    }
    throw new Error(m);
  }
}
/** Destination chain: one plain native payout from the provider signer to the payer, at or below safe. */
class Destination {
  constructor(private readonly route: Route, private readonly owner: () => string) {}
  async call(m: string): Promise<unknown> {
    if (m === "eth_chainId") return h(this.route.chain);
    if (m === "eth_getBlockByNumber") return { hash: DEST_BLOCK, number: h(100n) };
    if (m === "eth_getCode") return "0x";
    if (m === "eth_getTransactionByHash" || m === "eth_getTransactionReceipt") {
      const common = { hash: DEST_HASH, transactionHash: DEST_HASH, from: SIGNER, to: this.owner(), blockHash: DEST_BLOCK, blockNumber: h(100n) };
      return m === "eth_getTransactionByHash" ? { ...common, chainId: h(this.route.chain), input: "0x", value: h(BigInt(this.route.output)), nonce: h(7n) } : { ...common, status: "0x1" };
    }
    throw new Error(m);
  }
}

async function setup(t: test.TestContext, route: Route, profile: string, admission: (owner: string) => Record<string, unknown> = () => ({})) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  let now = Date.now();
  const wrapping = { load: async () => Buffer.alloc(32, 1), create: async () => Buffer.alloc(32, 1) };
  const ensured = await runCli(["wallet", "ensure", "--profile", profile], {}, { stateRoot: temp.root, wrappingSecret: wrapping });
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error));
  const owner = (ensured.data as { address: string }).address;
  const file = join(temp.base, "policy.json");
  await writeFile(file, JSON.stringify({ schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `synthetic.${route.name}.1`, accounts: { evm: owner },
    effectiveAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(),
    admissions: [{ chain: "eip155:8453", kind: "native", rail: "bridge", maximumPerTransferAtomic: "10000000000000", dailyLimitAtomic: "20000000000000",
      mechanism: route.mechanism, ...admission(owner) }] }), { mode: 0o600 });
  const staged = await runCli(["allowlist", "policy", "stage", "--profile", profile, "--file", file], {}, { stateRoot: temp.root });
  assert.equal(staged.ok, true, JSON.stringify(staged.error));
  let screen = "";
  const approval = new TtyAllowlistPolicyApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 11, write: async (s: string) => { screen += s; },
    read: async function* () { yield Buffer.from(`${[...screen.matchAll(/Type ([a-f0-9]{6})/gu)].at(-1)![1]!}\n`); }, close: async () => {} }) });
  const activated = await runCli(["allowlist", "policy", "activate", "--profile", profile, "--revision", "1"], {}, { stateRoot: temp.root, allowlistPolicyApproval: approval });
  assert.equal(activated.ok, true, JSON.stringify(activated.error));
  const source = new Source(route, () => owner), destination = new Destination(route, () => owner);
  let approvals = 0;
  const quote = (amount: string) => `{"calldata":"${route.data}","expires":${Math.floor(now / 1000) + 60},"quotes":[{"chain":${route.chain},"decimals":18,"expected":${route.output},"expectedNative":${route.output},"gas":1000,"speed":10.0,"usd":0.02}]}`;
  const deposit = (amount: string) => JSON.stringify({ deposit: { block: "100", chain: "8453", hash: keccak256(source.raw!), log: "0", sender: owner, shorts: [route.short],
    status: "CONFIRMED", time: "1", to: owner, usd: 0.02, value: amount }, txs: [{ chain: route.chain.toString(), hash: DEST_HASH, nonce: "7", refund: false, cancelled: false,
    signer: SIGNER, status: "CONFIRMED", time: "2", to: owner, usd: 0.02, value: route.output }] });
  let amountSent = "";
  const https = { request: async (url: string) => {
    if (url.includes("/quotes/")) { amountSent = url.split("/quotes/8453/")[1]!.split("/")[0]!; return { status: 200, body: quote(amountSent) }; }
    return { status: 200, body: deposit(amountSent) };
  } };
  const service = new route.service(state, wrapping, {}, { https, source: () => source, destination: () => destination, approve: async () => { approvals++; }, now: () => now });
  const cli = (args: readonly string[]) => runCli([route.name, "funding", ...args], {}, { stateRoot: temp.root, wrappingSecret: wrapping,
    ...(route.name === "mega" ? { megaFunding: service as MegaFundingService } : { seiFunding: service as SeiFundingService }) });
  const prepareArgs = (overrides: Record<string, string> = {}) => Object.entries({ "--profile": profile, "--expected-payer": owner, "--amount-atomic": "7000000000000",
    "--minimum-output-atomic": "1000000000000", "--maximum-fee-atomic": "1000000000000", "--idempotency-key": `${route.name}-any-profile-01`, ...overrides }).flat();
  return { owner, source, cli, prepareArgs, approvals: () => approvals, advance: (ms: number) => { now += ms; } };
}
const reason = (result: { readonly error: { readonly details?: Readonly<Record<string, unknown>> } | null }) => result.error?.details?.reason;

for (const route of ROUTES) {
  test(`${route.name} GasZip: a non-owner profile prepares, approves once and completes with its own wallet as payer and recipient`, async (t) => {
    const f = await setup(t, route, `${route.name}-funder`);
    const prepared = await f.cli(["prepare", ...f.prepareArgs()]);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    const op = prepared.data as { operationId: string; state: string; amountAtomic: string; owner: { address: string; profile: string } };
    assert.equal(op.state, "prepared"); assert.equal(op.amountAtomic, "7000000000000");
    assert.equal(op.owner.address, f.owner); assert.equal(op.owner.profile, `${route.name}-funder`);
    const approved = await f.cli(["approve", "--operation", op.operationId]);
    assert.equal(approved.ok, true, JSON.stringify(approved.error)); assert.equal(f.source.sends, 1); assert.equal(f.approvals(), 1);
    const signed = parseTransaction(f.source.raw!);
    assert.equal(signed.to?.toLowerCase(), route.target.toLowerCase()); assert.equal(signed.data, route.data); assert.equal(signed.value, 7_000_000_000_000n);
    const done = await f.cli(["status", "--operation", op.operationId]);
    assert.equal(done.ok, true, JSON.stringify(done.error));
    assert.equal((done.data as { state: string }).state, "completed"); assert.equal(f.source.sends, 1);
  });

  test(`${route.name} GasZip: the expected payer must be the profile wallet and the amount stays within the owner's caps`, async (t) => {
    const f = await setup(t, route, `${route.name}-capped`);
    assert.equal(reason(await f.cli(["prepare", ...f.prepareArgs({ "--expected-payer": OTHER })])), `${route.name}_gaszip_expected_payer`);
    const over = await f.cli(["prepare", ...f.prepareArgs({ "--amount-atomic": "10000000000001", "--idempotency-key": `${route.name}-over-cap-01` })]);
    assert.equal(over.ok, false); assert.equal(f.source.sends, 0);
  });

  test(`${route.name} GasZip: an owner recipient pin must list the payer, because the deposit pays the sender`, async (t) => {
    const refused = await setup(t, route, `${route.name}-pinned-away`, () => ({ recipients: [OTHER] }));
    const result = await refused.cli(["prepare", ...refused.prepareArgs()]);
    assert.equal(result.error?.code, "APN_ALLOWLIST_REFUSED"); assert.equal(reason(result), "allowlist_recipient_not_admitted");
    assert.equal(refused.source.sends, 0);
    const pinnedSelf = await setup(t, route, `${route.name}-pinned-self`, (owner) => ({ recipients: [OTHER, owner] }));
    const admitted = await pinnedSelf.cli(["prepare", ...pinnedSelf.prepareArgs()]);
    assert.equal(admitted.ok, true, JSON.stringify(admitted.error));
    assert.equal((await pinnedSelf.cli(["approve", "--operation", (admitted.data as { operationId: string }).operationId])).ok, true);
    assert.equal(pinnedSelf.source.sends, 1);
  });

  test(`${route.name} GasZip: an admission for another GasZip mechanism does not admit this route`, async (t) => {
    const f = await setup(t, route, `${route.name}-wrong-pin`, () => ({ mechanism: OTHER_ROUTE(route).mechanism }));
    assert.equal(reason(await f.cli(["prepare", ...f.prepareArgs()])), `${route.name}_gaszip_mechanism_not_admitted`);
    assert.equal(f.source.sends, 0);
  });
}
