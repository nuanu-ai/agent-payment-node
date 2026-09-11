import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindMcpInput } from "../../src/command-binder.js";
import { parseArgv, runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import type { SmartAccountPermissionStorePort } from "../../src/encrypted-smart-account-permission-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { capabilityHash, metamaskSmartAccountX402CapabilitySnapshot, PROVIDER_PROFILE_VERSION } from "../../src/provider-profile.js";
import type { SmartAccountGaslessSealedMaterial } from "../../src/smart-account-gasless/model.js";
import { saError } from "../../src/smart-account-gasless/reasons.js";
import { smartAccountGaslessRuntime } from "../../src/smart-account-gasless/runtime.js";
import type { SmartAccountGaslessDependencies } from "../../src/smart-account-gasless/service.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { SA_TEST_AT, SA_TEST_RECIPIENT, saStructuralMaterial, saStructuralUnused, saTestIntent } from "./smart-account-gasless-fixtures.js";

const KEY = "sa-surface-key", ID = "a".repeat(64);
const input = { profile: "sa-synthetic", chain: "8453", to: SA_TEST_RECIPIENT,
  amount: "0.01", max_fee: "0", min_received: "0.01", idempotency_key: KEY };
const argv = ["gasless", "transfer", "prepare", "--profile", input.profile, "--chain", input.chain,
  "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
  "--min-received", input.min_received, "--idempotency-key", KEY];
const forbidden = () => { throw new Error("synthetic private effect must remain unreachable"); };
const wrapping: WrappingSecretPort = { load: forbidden, create: forbidden };

async function connection(options: McpRuntimeOptions) {
  const server = createMcpServer(options), client = new Client({ name: "sa-surfaces", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, call: async (name: string, args: Record<string, string>) => {
    const result = await client.callTool({ name, arguments: args }), first = result.content[0];
    assert.ok(first && first.type === "text"); const envelope = JSON.parse(first.text) as OutputEnvelope;
    assert.deepEqual(envelope, result.structuredContent); return envelope;
  }, close: async () => { await client.close(); await server.close(); } };
}

/** These ports prove real CLI/MCP routing and counters; SDK/chain authentication has its own integration tests. */
async function fixture(stateRoot: string) {
  const state = new StateStore(stateRoot), original = saTestIntent(), capability = metamaskSmartAccountX402CapabilitySnapshot();
  const binding = { ...original.binding, capabilityHash: capabilityHash(capability) };
  await state.initialize();
  await state.writeProviderProfile({ schema_version: PROVIDER_PROFILE_VERSION, profile: input.profile,
    profile_hash: binding.profileHash, provider_id: "metamask-smart-account", public_address: binding.ownerAddress,
    account_binding_hash: binding.accountBindingHash, trust_class: binding.trustClass, revision: binding.profileRevision,
    capability_snapshot: capability, capability_hash: binding.capabilityHash, observed_at: SA_TEST_AT,
    drift: { state: "bound", reason: "none" } });
  let now = new Date(SA_TEST_AT), expired = false, sealed: SmartAccountGaslessSealedMaterial | null = null;
  let custodyUnavailable = false;
  const calls = { inspect: 0, snapshot: 0, supported: 0, seal: 0, load: 0, expose: 0, verify: 0, settle: 0, unspent: 0, observe: 0, approval: 0 };
  const clock = { now: () => now };
  const dependencies: SmartAccountGaslessDependencies = {
    material: {
      inspect: async () => { calls.inspect++; if (custodyUnavailable) throw saError("sa_gasless_permission"); return binding; },
      load: async () => { calls.load++; if (custodyUnavailable) forbidden(); return sealed; },
      seal: async op => { calls.seal++; sealed = saStructuralMaterial(op); return sealed; },
      markExposed: async (_op, value) => { calls.expose++; sealed = { ...value, phase: "exposed" }; return sealed; },
    },
    provider: {
      supported: async () => { calls.supported++; return original.provider; },
      verify: async () => { calls.verify++; return { observedAt: now.toISOString(), payer: binding.ownerAddress, isValid: true, responseHash: "1".repeat(64) }; },
      settle: async () => { calls.settle++; return { observedAt: now.toISOString(), transactionHash: null, responseHash: "2".repeat(64) }; },
    },
    rpcFor: () => ({ chainId: 8453, endpointOrigin: original.initialSnapshot.endpointOrigin, endpointHash: original.initialSnapshot.endpointHash,
      snapshot: async () => { calls.snapshot++; return { ...original.initialSnapshot, observedAt: now.toISOString() }; },
      assertUnspent: async () => { calls.unspent++; },
      observe: async value => { calls.observe++; return expired ? saStructuralUnused(value, now.toISOString()) : {
        cursor: value.cursor, observation: { observedAt: now.toISOString(), phase: "pending", reason: "sa_gasless_unknown",
          candidateTxHash: null, evidenceHash: null }, settlement: null, unusedProof: null }; },
    }),
    approval: { confirm: async value => { calls.approval++; assert.equal(value.exactPhrase,
      `APPROVE GASLESS ${value.operationId} ${value.fingerprint}`); return true; } },
  };
  return { state, binding, calls, dependencies, options: { stateRoot, smartAccountGasless: dependencies, wrappingSecret: wrapping, clock },
    expire: () => { expired = true; custodyUnavailable = true; now = new Date(Date.parse(SA_TEST_AT) + 600_000); } };
}

test("Smart Account static CLI/MCP discovery and approval handoff access no state, custody, provider or RPC", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const runtime = smartAccountGaslessRuntime({ state: new StateStore(temporary.root), permissions: { load: forbidden } as unknown as SmartAccountPermissionStorePort,
    wrapping, clock: { now: forbidden }, environment: new Proxy({}, { get: forbidden }), foregroundApproval: false });
  const options = { stateRoot: temporary.root, wrappingSecret: wrapping, smartAccountGasless: runtime }, c = await connection(options);
  t.after(c.close);
  const cli = await runCli(["gasless", "capabilities", "--profile", input.profile], {}, options);
  const mcp = await c.call("apn_gasless_capabilities", { profile: input.profile });
  assert.equal(cli.ok, true); assert.deepEqual(mcp.data, cli.data);
  const data = cli.data as any, semantics = data.provider_semantics["metamask-smart-account"];
  assert.equal(data.profile_binding_inspected, false);
  assert.deepEqual(data.provider_networks["metamask-smart-account"].map((row: any) => [row.chain_id, row.executable_adapter, row.mainnet_acceptance]), [[8453, true, "open"]]);
  assert.equal(semantics.fee_atomic, "0"); assert.equal(semantics.onchain_permission_expiry, true);
  assert.equal(semantics.recovery_after_exposure, "independent_chain_observation_only");
  const listed = await c.client.listTools(); assert.equal(listed.tools.length, 48);
  assert.deepEqual(listed.tools.map(tool => tool.name), projectMcpTools().map(tool => tool.name));
  const handoff = await c.call("apn_gasless_transfer_approve", { operation: ID });
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(handoff.error?.details?.cli_handoff_argv, ["apn", "gasless", "transfer", "approve", "--operation", ID]);
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("Smart Account balance and preparation have CLI/MCP parity without approval or private effects", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root), c = await connection(f.options); t.after(c.close);
  const tool = projectMcpTools().find(item => item.name === "apn_gasless_transfer_prepare")!;
  assert.deepEqual(bindMcpInput(tool.command, input), parseArgv(argv));
  const cliBalance = await runCli(["gasless", "balance", "--profile", input.profile, "--chain", "8453"], {}, f.options);
  const mcpBalance = await c.call("apn_gasless_balance", { profile: input.profile, chain: "8453" });
  assert.equal(cliBalance.ok, true, JSON.stringify(cliBalance.error)); assert.deepEqual(mcpBalance.data, cliBalance.data);
  assert.equal((cliBalance.data as any).owner_native_balance_wei, "0");
  assert.equal((cliBalance.data as any).available_allowance_atomic, "1000000");
  const prepared = await c.call("apn_gasless_transfer_prepare", input), calls = { ...f.calls };
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const replay = await runCli(argv, {}, f.options); assert.deepEqual(replay.operation, prepared.operation);
  assert.deepEqual(f.calls, calls); assert.equal(f.calls.seal + f.calls.verify + f.calls.settle + f.calls.approval, 0);
  const operation = prepared.operation as any;
  assert.deepEqual([operation.kind, operation.transfer.frozen_net_atomic, operation.transfer.frozen_fee_atomic], ["smart_account_gasless_transfer", "10000", "0"]);
  const foreign = await c.call("apn_gasless_transfer_prepare", { ...input, profile: "another-profile" });
  assert.equal(foreign.error?.code, "APN_IDEMPOTENCY_CONFLICT"); assert.deepEqual(f.calls, calls);
});

test("same-key routing survives a missing profile and all approval surfaces preserve the exact operation identity", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root), prepared = await runCli(argv, {}, f.options); assert.equal(prepared.ok, true);
  const op = prepared.operation as any, c = await connection(f.options); t.after(c.close);
  const calls = { ...f.calls };
  const generic = await c.call("apn_pay_transfer_approve", { operation: op.operation_id, rpc_url: "https://rpc.example" });
  assert.equal(generic.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(generic.next_actions, [`apn gasless transfer approve --operation ${op.operation_id}`]);
  assert.equal(generic.error?.details?.reason, "sa_gasless_approval"); assert.deepEqual(f.calls, calls);
  await f.state.removeProviderProfile(f.binding.profileHash);
  const replay = await runCli(argv, {}, f.options); assert.equal(replay.ok, true, JSON.stringify(replay.error));
  assert.deepEqual(replay.operation, prepared.operation); assert.deepEqual(f.calls, calls);
  const waited = await c.call("apn_operation_resume", { operation: op.operation_id, wait_seconds: "1" });
  assert.equal(waited.error?.code, "APN_INVALID_INPUT"); assert.deepEqual(f.calls, calls);
});

test("CLI approval dispatches once and cold public recovery/terminal replay uses RPC alone after custody disappears", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root), prepared = await runCli(argv, {}, f.options), op = prepared.operation as any;
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const approved = await runCli(["gasless", "transfer", "approve", "--operation", op.operation_id], {}, f.options);
  assert.equal(approved.ok, true, JSON.stringify(approved.error)); assert.equal((approved.operation as any).state, "unknown_finality");
  assert.deepEqual([f.calls.approval, f.calls.seal, f.calls.verify, f.calls.settle], [1, 1, 1, 1]);
  const counts = { ...f.calls }; f.expire();
  const c = await connection(f.options); t.after(c.close);
  const resumed = await c.call("apn_operation_resume", { operation: op.operation_id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error)); assert.equal((resumed.operation as any).state, "expired_unused");
  assert.equal((resumed.operation as any).permission.guard_held, false);
  assert.equal((resumed.operation as any).fees.unused_gross_atomic, "10000");
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) assert.equal(f.calls[key], counts[key] + (key === "observe" ? 1 : 0), key);
  const receiptPath = join(temporary.root, "smart-account-gasless-receipts", f.binding.profileHash, `${op.operation_id}.json`);
  const before = await readFile(receiptPath), finalCounts = { ...f.calls };
  const status = await runCli(["operation", "status", "--operation", op.operation_id], {}, f.options);
  const repeat = await runCli(["gasless", "transfer", "approve", "--operation", op.operation_id], {}, f.options);
  assert.deepEqual(status.operation, resumed.operation); assert.deepEqual(repeat.operation, resumed.operation);
  const cliReceipt = await runCli(["receipt", "get", "--operation", op.operation_id], {}, f.options);
  const mcpReceipt = await c.call("apn_receipt_get", { operation: op.operation_id });
  assert.deepEqual(cliReceipt.receipt, mcpReceipt.receipt); assert.deepEqual(await readFile(receiptPath), before);
  assert.deepEqual(f.calls, finalCounts);
  const publicBytes = JSON.stringify([approved, resumed, cliReceipt]);
  for (const secret of ["0x1234", "permissionContext", "paymentPayload", "session_private_key"]) assert.equal(publicBytes.includes(secret), false, secret);
});

test("non-Base Smart Account requests fail before material, provider or RPC access", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root), c = await connection(f.options); t.after(c.close);
  for (const chain of ["1", "137", "143", "1329", "42161"]) {
    const balance = await c.call("apn_gasless_balance", { profile: input.profile, chain });
    const prepared = await c.call("apn_gasless_transfer_prepare", { ...input, chain, idempotency_key: `unadmitted-${chain}` });
    assert.equal(balance.ok, false); assert.equal(prepared.ok, false);
  }
  assert.ok(Object.values(f.calls).every(value => value === 0));
});
