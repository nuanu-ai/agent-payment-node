import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { RpcReadSession } from "../../src/lifi/rpc.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2 } from "../../src/swap/uniswap-v3/pins.js";
import { UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { UniswapTokenRpcBudgetJournal } from "../../src/swap/uniswap-v3/token-rpc-budget.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import type { TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-23T00:00:00.000Z"), PROFILE = "token-mcp-owner";
const KEY = `0x${"0".repeat(63)}1` as const, ACCOUNT = privateKeyToAccount(KEY).address;
const BLOCK = `0x${"b".repeat(64)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const quoteArgs = { profile: PROFILE, account: ACCOUNT, to: ACCOUNT, source_token: ETHEREUM_USDT,
  output_token: UNISWAP_USDC, amount: "1000000", minimum_output: "990000", approval_cap: "1000000",
  deadline: String(Math.floor(NOW.getTime() / 1000) + 600), max_approval_gas_limit: "100000",
  max_swap_gas_limit: "200000", max_cleanup_gas_limit: "100000", max_fee_per_gas: "2",
  max_priority_fee_per_gas: "1", max_native_debit: "800000" };

async function admitted(root: string) {
  return await activateDirectPolicy(root, PROFILE, { accounts: { evm: ACCOUNT }, now: NOW,
    admissions: [ETHEREUM_USDT, UNISWAP_USDC].map((identifier) => ({ chain: "eip155:1", kind: "token" as const,
      identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000",
      mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
}

function rpc() {
  let physical = 0, logical = 0, effects = 0; const methods: string[] = [];
  const value = (method: string, params: readonly unknown[]): unknown => {
    methods.push(method);
    if (method === "eth_sendRawTransaction") effects += 1;
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: BLOCK, baseFeePerGas: "0x0" };
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_getBalance") return "0x100000";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_call") {
      const tx = params[0] as { readonly to: string; readonly data: string };
      if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${word(1_000_000n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}`;
      if (tx.data.startsWith("0xdd62ed3e")) return word(0n);
      if (tx.data.startsWith("0x70a08231")) return word(2_000_000n);
      return "0x";
    }
    throw new Error(`unexpected RPC method ${method}`);
  };
  const call = (async (method: string, params: readonly unknown[]) => { physical += 1; logical += 1; return value(method, params); }) as TokenRpcCall;
  Object.defineProperties(call, {
    batch: { value: async (_route: string, items: readonly { method: string; params: readonly unknown[] }[]) => {
      assert.ok(items.length >= 1 && items.length <= 3); physical += 1; logical += items.length;
      return items.map((item) => value(item.method, item.params)); } },
    telemetry: { value: () => ({ ...new RpcReadSession().telemetry(), httpRequests: physical, httpAttempts: physical, logicalItems: logical }) },
    effectAttempts: { value: () => effects },
  });
  return { call, counts: () => ({ physical, logical, effects }), methods };
}

async function session(root: string, t: test.TestContext) {
  const state = new StateStore(root), master = Buffer.alloc(32, 19), wrapping = { load: async () => Buffer.from(master), create: async () => Buffer.from(master) };
  const fake = rpc();
  const runtime = createUniswapTokenRuntime({ state, wrapping, clock: { now: () => NOW }, call: fake.call, foreground: "refuse",
    verifyPins: async (_call, tag) => { assert.equal(tag, "0x64"); } });
  const server = createMcpServer({ stateRoot: root, uniswapTokenRuntime: runtime, clock: { now: () => NOW } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "uniswap-token-offline-acceptance", version: "1" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (action: string, args: Record<string, unknown>): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name: `apn_swap_ethereum_uniswap_token_${action}`, arguments: args });
    const content = result.content[0]; if (content?.type !== "text") throw new Error("expected MCP text result");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  return { ...fake, call, state, wrapping };
}

test("offline MCP USDT to USDC quote, prepare, status and foreground handoff stay within read budgets", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); await admitted(temp.root);
  const quoteSession = await session(temp.root, t), quoted = await quoteSession.call("quote", quoteArgs);
  assert.equal(quoted.ok, true); const quote = quoted.data as { quoteHash: string; route: { inputToken: string; outputToken: string };
    expectedOutputAtomic: string; signed: boolean; broadcast: boolean };
  assert.equal(quote.route.inputToken, ETHEREUM_USDT); assert.equal(quote.route.outputToken, UNISWAP_USDC);
  assert.equal(quote.expectedOutputAtomic, "1000000"); assert.equal(quote.signed, false); assert.equal(quote.broadcast, false);
  assert.deepEqual(quoteSession.counts(), { physical: 4, logical: 7, effects: 0 });
  const preparedSession = await session(temp.root, t);
  await preparedSession.state.initialize();
  await new EncryptedWalletStore(preparedSession.state, preparedSession.wrapping).importNew(PROFILE, KEY, ACCOUNT);
  const prepared = await preparedSession.call("prepare", { profile: PROFILE, quote: quote.quoteHash, idempotency_key: "offline-c3-09" });
  assert.equal(prepared.ok, true); const operation = prepared.operation as { operationId: string; phase: string; approvalAttempt: unknown; swapAttempt: unknown };
  assert.equal(operation.phase, "prepared"); assert.equal(operation.approvalAttempt, null); assert.equal(operation.swapAttempt, null);
  assert.deepEqual(preparedSession.counts(), { physical: 5, logical: 10, effects: 0 });
  const statusSession = await session(temp.root, t), status = await statusSession.call("status", { operation: operation.operationId });
  assert.equal(status.ok, true); assert.equal((status.operation as { phase: string }).phase, "prepared");
  assert.deepEqual(statusSession.counts(), { physical: 0, logical: 0, effects: 0 });
  for (const action of ["approve", "execute", "cleanup"]) {
    const handoff = await statusSession.call(action, { operation: operation.operationId });
    assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(handoff.error?.details?.cli_handoff, `apn swap ethereum uniswap-token ${action} --operation ${operation.operationId}`);
  }
  assert.deepEqual(statusSession.counts(), { physical: 0, logical: 0, effects: 0 });
  const rows = (await new UniswapTokenRpcBudgetJournal(temp.root).load(operation.operationId))!.rows;
  assert.deepEqual(rows.map((row) => [row.command, row.cap, row.physicalRequests, row.logicalItems]), [
    ["swap.uniswap-token.quote", 8, 4, 7], ["swap.uniswap-token.prepare", 9, 5, 10], ["swap.uniswap-token.status", 0, 0, 0],
  ]);
  assert.ok(rows.every((row) => row.attempts === row.physicalRequests && row.budgetRejects === 0));
  assert.equal(quoteSession.methods.includes("eth_sendRawTransaction"), false);
  assert.equal(preparedSession.methods.includes("eth_sendRawTransaction"), false);
  assert.equal(statusSession.methods.length, 0);
});

test("inactive and changed owner policy refuse MCP quote or prepare without an operation or effect", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const inactive = await session(temp.root, t), denied = await inactive.call("quote", quoteArgs);
  assert.equal(denied.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(denied.error?.details?.reason, "swap_owner_admission_required");
  assert.deepEqual(inactive.counts(), { physical: 1, logical: 2, effects: 0 });
  await admitted(temp.root);
  const quoted = await (await session(temp.root, t)).call("quote", quoteArgs);
  assert.equal(quoted.ok, true); const quoteHash = (quoted.data as { quoteHash: string }).quoteHash;
  await admitted(temp.root);
  const changed = await session(temp.root, t), prepared = await changed.call("prepare", { profile: PROFILE, quote: quoteHash, idempotency_key: "rejected-c3-09" });
  assert.equal(prepared.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(prepared.error?.details?.reason, "uniswap_token_policy_changed");
  assert.deepEqual(changed.counts(), { physical: 0, logical: 0, effects: 0 });
  const operationId = domainHash("apn.uniswap-token-operation-id.v1", canonicalJson({ profile: PROFILE,
    quoteHash, idempotencyKey: "rejected-c3-09" }));
  assert.equal((await new UniswapTokenJournal(temp.root).load(operationId)), null);
  assert.equal((await new UniswapTokenRpcBudgetJournal(temp.root).load(quoteHash))!.rows.at(-1)?.physicalRequests, 0);
  assert.equal(changed.methods.includes("eth_sendRawTransaction"), false);
});
