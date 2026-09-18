import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { hashObject } from "../../src/canonical.js";
import * as cliRuntime from "../../src/cli.js";
import { testRuntime } from "./installed-runtime.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { evmDirectFingerprint } from "../../src/evm-direct.js";
import { evmCustodyPayload } from "../../src/evm-transfer-approval.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OperationRecord } from "../../src/model.js";
import { parseEvmNativeIntent } from "../../src/evm-native-intent.js";
import type { ProviderProfileRecord } from "../../src/provider-profile.js";
import { sealOperation, validateOperation } from "../../src/state-integrity.js";
import { EVM_REQUEST, EVM_TOKEN, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");

for (const chainId of [8453, 1, 42161] as const) test(`chain ${chainId}: a real terminated process leaves started state and a separate process resumes exactly once without signing`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
  setup.rpc.chainId = chainId;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { ...EVM_REQUEST.asset, chainId } }) as { operation_id: string };
  const worker = fileURLToPath(new URL("./evm-crash-worker.js", import.meta.url));
  const crashed = spawnSync(process.execPath, [worker, "sign-crash", temporary.root, prepared.operation_id], { encoding: "utf8", timeout: 15000 });
  assert.equal(crashed.status, 74, crashed.stderr);
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "started");
  const resumed = spawnSync(process.execPath, [worker, "resume", temporary.root, prepared.operation_id], { encoding: "utf8", timeout: 15000 });
  assert.equal(resumed.status, 0, resumed.stderr);
  const result = JSON.parse(resumed.stdout);
  assert.equal(result.result.state, "completed"); assert.equal(result.approvals, 0); assert.equal(result.submissions, 1);
  const replay = spawnSync(process.execPath, [worker, "resume", temporary.root, prepared.operation_id], { encoding: "utf8", timeout: 15000 });
  assert.equal(replay.status, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).submissions, 0);
});

for (const chainId of [8453, 1, 42161] as const) for (const kind of ["native", "usdc"] as const) test(`MCP ${chainId}/${kind} prepare and balance share CLI state, handoff stays unsigned, and CLI completes the same operation`, async (context) => {
  const asset = kind === "native" ? "native" : EVM_USDC[chainId];
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  setup.rpc.chainId = chainId;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  const server = createMcpServer({ stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-evm-parity-test", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, string>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const selection = { profile: "default", chain: `eip155:${chainId}`, asset, rpc_url: "https://rpc.example" };
  const balance = await invoke("apn_wallet_balance_asset", selection); assert.equal(balance.ok, true, JSON.stringify(balance));
  const prepared = await invoke("apn_pay_transfer_prepare_asset", { ...selection, to: EVM_REQUEST.recipient, amount: EVM_REQUEST.amount, max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: EVM_REQUEST.idempotencyKey });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operation = prepared.operation as { operation_id: string };
  const before = await setup.state.findOperation(operation.operation_id);
  const loads = setup.wrapping.loads, rpcCalls = setup.rpc.genericBalanceCalls;
  const handoff = await invoke("apn_pay_transfer_approve", { operation: operation.operation_id, rpc_url: selection.rpc_url });
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED", JSON.stringify(handoff));
  assert.deepEqual(await setup.state.findOperation(operation.operation_id), before);
  assert.equal(setup.wrapping.loads, loads); assert.equal(setup.rpc.genericBalanceCalls, rpcCalls); assert.equal(setup.rpc.submissions.length, 0);
  const approved = await runCli(["pay", "transfer", "approve", "--operation", operation.operation_id, "--rpc-url", selection.rpc_url], {}, {
    stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping, approval: setup.approval,
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { state: string }).state, "completed");
  const status = await invoke("apn_operation_status", { operation: operation.operation_id });
  assert.deepEqual(status.operation, approved.operation);
  assert.equal((await invoke("apn_receipt_get", { operation: operation.operation_id })).ok, true);
});

test("parallel duplicate generic prepares serialize and other asset or kind cannot bypass profile exclusion", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
  const [first, second] = await Promise.all([setup.core.transfer.prepare(EVM_REQUEST), setup.core.transfer.prepare(EVM_REQUEST)]);
  assert.deepEqual(first, second); assert.equal(setup.rpc.genericBalanceCalls, 1);
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] }, idempotencyKey: "evm-other-token-001" }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(setup.core.transfer.prepare({ command: "transfer.prepare", profile: "default", recipient: EVM_REQUEST.recipient, amount: "1", idempotencyKey: EVM_REQUEST.idempotencyKey }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.equal(setup.rpc.genericBalanceCalls, 1);
});

test("generic external profiles fail before RPC, signing or provider calls", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
  for (const providerId of ["coinbase-agentic-wallet", "metamask-agent-wallet", "metamask-smart-account"]) {
    const core = new ApnCore({ state: setup.state, rpc: setup.rpc, native: setup.local, profileRepository: {
      load: async () => ({ provider_id: providerId }) as ProviderProfileRecord,
      save: async () => { throw new Error("unexpected profile mutation"); }, remove: async () => { throw new Error("unexpected profile mutation"); },
    } });
    await assert.rejects(core.transfer.prepare(EVM_REQUEST), { code: "APN_PROVIDER_UNAVAILABLE" });
    assert.equal(setup.rpc.genericBalanceCalls, 0); assert.equal(setup.approval.intents.length, 0);
    for (const chainId of [1, 42161] as const) {
    const unsupported = await core.execute({ ...EVM_REQUEST, asset: { chainId, token: "native" } });
    assert.equal(unsupported.error?.code, "APN_PROVIDER_UNAVAILABLE");
    const x402 = await core.execute({ command: "x402.fetch.prepare", profile: "default", chainId, url: "https://seller.example/resource", idempotencyKey: "eth-provider-no-effect" });
    assert.equal(x402.error?.code, "APN_PROVIDER_UNAVAILABLE");
    }
  }
});

test("frozen custody fields cannot authorize another effect and state writes cannot rewind or rebind", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const original = (await setup.state.findOperation(prepared.operation_id))!;
  const payload = evmCustodyPayload(original);
  assert.equal(parseEvmNativeIntent(payload).evm.asset.kind, "native");
  for (const change of [{ chainId: 1 }, { fingerprint: "1".repeat(64) }, { walletAddress: EVM_TOKEN }, { extra: true }, { transaction: { ...(payload.transaction as object), data: "0x095ea7b3" } }, { transaction: { ...(payload.transaction as object), valueAtomic: "2" } }]) {
    assert.throws(() => parseEvmNativeIntent({ ...payload, ...change }));
  }
  const changed = { ...original, amountAtomic: "2000000000000", amountDecimal: "0.000002", evm: { ...original.evm!, valueAtomic: "2000000000000" } };
  const rebound: OperationRecord = { ...changed, fingerprint: evmDirectFingerprint(changed), integrityHash: "" };
  const { integrityHash: _integrityHash, ...reboundBody } = rebound;
  const sealed = sealOperation(reboundBody);
  validateOperation(sealed);
  await assert.rejects(setup.state.writeOperation(sealed), { code: "APN_STATE_CORRUPT" });
  assert.notEqual(hashObject(payload), hashObject(evmCustodyPayload(rebound)));
  await setup.core.transfer.approve(prepared.operation_id);
  await assert.rejects(setup.state.writeOperation(original), { code: "APN_STATE_CORRUPT" });
});
