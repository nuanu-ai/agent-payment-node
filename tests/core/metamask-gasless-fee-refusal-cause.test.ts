import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnError } from "../../src/errors.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { MetaMaskGaslessProviderClient } from "../../src/metamask-gasless/client/process.js";
import { readDiagnostic, validateReadDiagnostic } from "../../src/metamask-gasless/client/read-diagnostic.js";
import type { MetaMaskGaslessChainId } from "../../src/metamask-gasless/model.js";
import { temporaryState } from "./helpers.js";
import { MM_TEST_RECIPIENT, mmFixture } from "./metamask-gasless-helpers.js";
import { NOW, quoteInput, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

/**
 * QA 0.5.52 METAMASK-FEE-REFUSAL-ASSET-GUIDANCE-001, evidence mm-ethereum-052-fee-explanation02/03: two read-only
 * Ethereum fee quotes whose low tier had no `tokenFees`, its literal error and these public numeric terms (balanceNeeded is
 * exactly gas x maxFeePerGas; currentBalance is the server wallet's native ETH, its USDC was 983141 atoms).
 */
const CAPTURED = [
  { maxFeePerGas: "0x80dd01ee", maxPriorityFeePerGas: "0x7d2b7501", gas: "0x11555", balanceNeeded: "0x8b99ec782a06", currentBalance: "0x12309ce54000" },
  { maxFeePerGas: "0x80d4c2cd", maxPriorityFeePerGas: "0x7d2b7501", gas: "0x11555", balanceNeeded: "0x8b90fd6c7f11", currentBalance: "0x12309ce54000" },
] as const;
const PROVIDER_ERROR = "Not enough funds";
const NATIVE_MESSAGE = (required: string, requiredEth: string, price: string) => "MetaMask quoted no USDC relay fee for this " +
  "transfer on Ethereum (chain 1): its fee quote answered HTTP 200 with result.transactions[-1].fees[0].tokenFees missing. Its " +
  `simulation of the transfer needs native ETH for gas: required ${required} wei (${requiredEth} ETH) = 70997 gas x ${price} wei per gas, ` +
  "current server-wallet balance 20000000000000 wei (0.00002 ETH). MetaMask reported a native gas shortfall, not a USDC one.";
const UNVERIFIED = "and named no cause APN can verify. APN does not read a missing relay fee as a USDC or native gas shortfall.";

/** The Sentinel answer with one chosen low fee tier, shaped as the provider sends it. */
class TierExchange extends SdkExchange {
  constructor(chainId: number, readonly tier: Record<string, unknown>) { super(chainId); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 10, result: {
      transactions: [{ status: "0x1", fees: [this.tier] }], sponsorship: { isSponsored: false, error: null } } }) };
  }
}
/** A priced quote whose server wallet holds less USDC than the transfer plus the quoted fee. */
class LowUsdcExchange extends SdkExchange {
  constructor(chainId: number, readonly balance: bigint) { super(chainId); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (!request.url.includes("rpc.example.test")) return response;
    const rpc = JSON.parse(request.body!) as { id: unknown; params: [{ data: string }] };
    if (!rpc.params[0].data.startsWith("0x70a08231")) return response;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: `0x${this.balance.toString(16).padStart(64, "0")}` }) };
  }
}
/** The parent's refusal for one normal quote through the pinned helper, and the helper's own raw answer to a second one. */
async function refusal(exchange: SdkExchange, chainId: MetaMaskGaslessChainId) {
  const home = await syntheticHome();
  try {
    const run = async (request: unknown) => await executeHelperRequest(structuredClone(request), { homeDirectory: home.home, now: () => NOW, exchange });
    const client = new MetaMaskGaslessProviderClient({ runner: { run } });
    const error = await client.quote(quoteInput(home.binding, chainId)).then(() => assert.fail("expected a refusal"), (e: unknown) => e);
    assert.ok(error instanceof ApnError);
    const requests = exchange.requests.length;
    const raw = await run({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, chainId) });
    return { error, raw, requests };
  } finally { await home.cleanup(); }
}

test("the captured Ethereum answer is refused as a native gas shortfall in proven units and never as USDC", async t => {
  for (const [index, tier] of CAPTURED.entries()) await t.test(`explanation0${index + 2}`, async () => {
    const exchange = new TierExchange(1, { ...tier, error: PROVIDER_ERROR }), { error, raw } = await refusal(exchange, 1);
    const [required, requiredEth, price] = index === 0 ? ["153493213555206", "0.000153493213555206", "2161967598"]
      : ["153454843297553", "0.000153454843297553", "2161427149"];
    assert.equal(error.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(error.message, NATIVE_MESSAGE(required, requiredEth, price));
    assert.deepEqual([error.details?.reason, error.details?.mm_read_native_gas_units, error.details?.mm_read_native_max_fee_per_gas_wei,
      error.details?.mm_read_native_required_wei, error.details?.mm_read_native_current_wei, error.details?.provider_cause,
      error.details?.native_symbol, error.details?.mm_read_sentinel_fee_error],
    ["mm_gasless_fee_unquoted", "70997", price, required, "20000000000000", "native_gas_below_required", "ETH", "present"]);
    for (const text of [JSON.stringify(raw), JSON.stringify({ message: error.message, details: error.details })]) {
      assert.equal(text.includes(PROVIDER_ERROR), false, "provider text never crosses the helper boundary");
    }
    assert.equal(exchange.beforeSends, 0);
    assert.equal(exchange.requests.some(request => request.url.includes("transaction-requests")), false);
  });
});

test("tiers whose numbers do not prove a native shortfall claim no cause", async t => {
  const [tier] = CAPTURED;
  const cases: Record<string, Record<string, unknown>> = {
    "no error": { ...tier },
    "needed is not gas x price": { ...tier, error: PROVIDER_ERROR, balanceNeeded: "0x8b99ec782a07" },
    "current covers needed": { ...tier, error: PROVIDER_ERROR, currentBalance: "0x8b99ec782a06" },
    "non-canonical quantity": { ...tier, error: PROVIDER_ERROR, gas: "0x011555" },
    "no numbers": { error: PROVIDER_ERROR },
  };
  for (const [name, shape] of Object.entries(cases)) await t.test(name, async () => {
    const { error } = await refusal(new TierExchange(1, shape), 1);
    assert.equal(error.message, "MetaMask quoted no USDC relay fee for this transfer on Ethereum (chain 1): its fee quote answered HTTP 200 " +
      `with result.transactions[-1].fees[0].tokenFees missing ${UNVERIFIED}`);
    assert.equal(error.details?.provider_cause, "unverified");
    assert.equal(Object.keys(error.details ?? {}).some(key => key.startsWith("mm_read_native_")), false);
  });
  const nulled = await refusal(new TierExchange(42161, { ...tier, tokenFees: null, error: PROVIDER_ERROR }), 42161);
  assert.equal(nulled.error.details?.mm_read_token_fees_kind, "null");
  assert.equal(nulled.error.details?.mm_read_native_required_wei, "153493213555206");
  assert.match(nulled.error.message, /^MetaMask quoted no USDC relay fee for this transfer on Arbitrum One \(chain 42161\): .* native ETH for gas/u);
});

test("APN's own balance read below the transfer plus the quoted fee is a USDC refusal with both numbers", async t => {
  for (const [chainId, network, required] of [[8453, "Base", "1000000"], [1, "Ethereum", "1000050"]] as const) await t.test(network, async () => {
    const exchange = new LowUsdcExchange(chainId, 500000n), { error, requests } = await refusal(exchange, chainId);
    assert.equal(error.code, "APN_INSUFFICIENT_USDC");
    assert.equal(error.message, `The MetaMask server wallet on ${network} (chain ${chainId}) holds 500000 USDC atoms (0.5 USDC), below the ` +
      `${required} USDC atoms (${Number(required) / 1e6} USDC) this transfer plus MetaMask's quoted USDC relay fee needs (APN's own balanceOf read at the fee quote).`);
    assert.deepEqual([error.details?.reason, error.details?.mm_read_stage, error.details?.mm_read_invariant, error.details?.mm_read_usdc_current_atomic,
      error.details?.mm_read_usdc_required_atomic], ["mm_gasless_balance", "fee_quote", "closed_failure", "500000", required]);
    assert.equal(requests, 6, "the normal quote reads, including the balance word"); assert.equal(exchange.beforeSends, 0);
  });
  const covered = await refusal(new TierExchange(8453, { error: PROVIDER_ERROR }), 8453);
  assert.equal(covered.error.details?.mm_read_usdc_current_atomic, undefined, "no balance read, no USDC fact");
});

test("prepare's next action follows only the proven cause, identically in CLI and MCP, and writes nothing", async t => {
  const { error: native } = await refusal(new TierExchange(1, { ...CAPTURED[0], error: PROVIDER_ERROR }), 1);
  const { error: unverified } = await refusal(new TierExchange(1, { error: PROVIDER_ERROR }), 1);
  const { error: usdc } = await refusal(new LowUsdcExchange(1, 500000n), 1);
  const cases: ReadonlyArray<readonly [ApnError, readonly (string | null)[]]> = [
    [native, ["MetaMask's relay simulation for this transfer on Ethereum (chain 1) needs 153493213555206 wei of native ETH for gas on the " +
      "server wallet, which holds 20000000000000 wei. APN neither sends this transfer with native gas instead nor reads it as a USDC " +
      "shortfall. No operation was written, so the same prepare may run again once MetaMask quotes a USDC relay fee."]],
    [unverified, ["MetaMask's fee quote named no cause APN can verify, so APN cannot tell whether USDC, native gas or the relay itself " +
      "is short. No operation was written, so the same prepare may run again."]],
    [usdc, [null, "The server wallet's USDC on Ethereum (chain 1) is 500050 atoms (0.50005 USDC) short of this transfer plus MetaMask's " +
      "quoted relay fee. No operation was written, so the same prepare may run again once it holds at least 1000050 USDC atoms."]],
  ];
  for (const [index, [refused, expected]] of cases.entries()) await t.test(String(index), async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const f = await mmFixture(temporary.root, 1);
    f.provider.quote = async () => { throw refused; };
    const options: McpRuntimeOptions = { stateRoot: temporary.root, metaMaskGasless: f.dependencies, clock: f.clock };
    const connection = await connectMcp(options); t.after(connection.close);
    const key = `qa-0552-mm-native-gas-0${index}`;
    const cli = await runCli(["gasless", "transfer", "prepare", "--profile", f.profile, "--chain", "1", "--to", MM_TEST_RECIPIENT,
      "--net-amount-atomic", "1000", "--max-gross-atomic", "100000", "--max-fee-atomic", "99000", "--idempotency-key", key], {}, options);
    const mcp = decode(await connection.client.callTool({ name: "apn_gasless_transfer_prepare", arguments: { profile: f.profile, chain: "1",
      to: MM_TEST_RECIPIENT, net_amount_atomic: "1000", max_gross_atomic: "100000", max_fee_atomic: "99000", idempotency_key: key } }));
    assert.deepEqual({ ...mcp, request_id: null }, { ...cli, request_id: null });
    assert.equal(cli.ok, false); assert.equal(cli.operation, null); assert.equal(cli.error?.message, refused.message);
    assert.deepEqual(cli.next_actions, expected.map(action => action ?? `apn gasless balance --profile ${f.profile} --chain 1`));
    if (refused !== usdc) assert.equal(cli.next_actions.some(action => action.includes("gasless balance")), false);
    assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
    assert.equal(f.provider.submissions.length, 0); assert.equal(f.approval.calls.length, 0);
  });
});

test("a fee above the owner cap and a relay MetaMask withholds never point at USDC", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 1);
  f.provider.fees = ["60000"];
  const capped = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: "mm-fee-cap-01" });
  assert.equal(capped.error?.code, "APN_FEE_BUDGET_EXCEEDED"); assert.equal(capped.error?.details?.reason, "mm_gasless_fee_cap");
  const unrelayed = new TierExchange(10, {}), home = await syntheticHome(); t.after(home.cleanup);
  const run = async (request: unknown) => await executeHelperRequest(structuredClone(request), { homeDirectory: home.home, now: () => NOW,
    exchange: { request: async (r: FetchExchangeRequest) => {
      const response = await unrelayed.request(r);
      if (!r.url.endsWith("/networks")) return response;
      const body = JSON.parse(response.body) as Record<string, Record<string, unknown>>;
      return { status: 200, body: JSON.stringify({ ...body, 10: { ...body["10"], relayTransactions: false } }) };
    } } });
  const relay = await new MetaMaskGaslessProviderClient({ runner: { run } }).quote(quoteInput(home.binding, 10)).then(() => undefined, (e: unknown) => e);
  assert.ok(relay instanceof ApnError); assert.equal(relay.details?.reason, "mm_gasless_relay_unsupported");
  const temporary10 = await temporaryState(); t.after(temporary10.cleanup);
  const f10 = await mmFixture(temporary10.root, 10);
  f10.provider.quote = async () => { throw relay; };
  const withheld = await f10.core.execute({ command: "gasless.transfer.prepare", profile: f10.profile, request: f10.request, idempotencyKey: "mm-relay-01" });
  for (const result of [capped, withheld]) {
    assert.equal(result.ok, false); assert.equal(result.operation, null);
    assert.equal(JSON.stringify(result.next_actions).includes("USDC"), false);
    assert.equal(result.next_actions.some(action => action.includes("gasless balance")), false);
  }
});

test("native and USDC facts are closed: proven numbers only, on their own refusal only", () => {
  const fee = readDiagnostic("quote", "fee_quote", "network_validation", "sentinel-quote", 200, null, "none", false, "sentinel_token_fees", "missing",
    { sentinelSimulation: "succeeded", sentinelFeeError: "present", sentinelSponsorship: "not_sponsored" });
  const native = { nativeGasUnits: "70997", nativeMaxFeePerGasWei: "2161967598", nativeRequiredWei: "153493213555206", nativeCurrentWei: "20000000000000" };
  assert.deepEqual(validateReadDiagnostic({ ...fee, ...native }, "quote"), { ...fee, ...native });
  const closed = readDiagnostic("quote", "fee_quote", "closed_failure");
  const usdc = { usdcCurrentAtomic: "500000", usdcRequiredAtomic: "1000050" };
  assert.deepEqual(validateReadDiagnostic({ ...closed, ...usdc }, "quote"), { ...closed, ...usdc });
  for (const candidate of [
    { ...fee, ...native, nativeRequiredWei: "153493213555207" }, { ...fee, ...native, nativeCurrentWei: "153493213555206" },
    { ...fee, ...native, nativeGasUnits: "0x11555" }, { ...fee, nativeGasUnits: "70997" }, { ...fee, ...native, sentinelFeeError: "absent" },
    { ...fee, ...native, tokenFeesKind: "object" }, { ...closed, ...native },
    { ...closed, ...usdc, usdcCurrentAtomic: "1000050" }, { ...closed, usdcCurrentAtomic: "1" }, { ...fee, ...usdc },
    { ...readDiagnostic("quote", "relay_support", "closed_failure"), ...usdc },
  ]) assert.throws(() => validateReadDiagnostic(candidate, "quote"), JSON.stringify(candidate));
});

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-metamask-fee-refusal-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}
