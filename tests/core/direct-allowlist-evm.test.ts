import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { canonicalJson } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { DirectAllowlistGate } from "../../src/direct-allowlist-gate.js";
import { ApnError } from "../../src/errors.js";
import { evmAllowlistSubject } from "../../src/evm-direct-allowlist.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type { Address, OperationRecord } from "../../src/model.js";
import { appendTransition, sealOperation } from "../../src/state-integrity.js";
import { EVM_USDC, activateDirectPolicy, directAdmission, directUsage, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { EVM_REQUEST, EVM_TOKEN, EvmApproval, EvmTestRpc, EvmWrappingSecret, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const BASE = "eip155:8453";
const ETH_CAPS = { maximumPerTransferAtomic: "1200000000000000", dailyLimitAtomic: "4000000000000000" };
const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === reason;
const eth = (amount: string, key: string) => ({ ...EVM_REQUEST, amount, idempotencyKey: key });

async function owner(root: string, caps = ETH_CAPS, extra: { expiresAt?: string } = {}) {
  const setup = evmCore(root);
  const wallet = await setup.core.wallet.ensure("default") as { address: Address };
  setup.rpc.sender = wallet.address;
  const policy = await activateDirectPolicy(root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(),
    admissions: [directAdmission(BASE, null, caps), directAdmission(BASE, EVM_USDC[8453])], ...extra });
  return { ...setup, wallet, policy };
}

async function mcpClient(t: test.TestContext, root: string, rpc: EvmTestRpc) {
  const server = createMcpServer({ stateRoot: root, rpc, wrappingSecret: new EvmWrappingSecret() });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b);
  const client = new Client({ name: "direct-allowlist-evm", version: "1" }); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return async (input: Record<string, string>) => (await client.callTool({ name: "apn_pay_transfer_prepare_asset", arguments: input })).structuredContent as unknown as OutputEnvelope;
}

test("unlisted networks, unpinned contracts and wrong decimals refuse identically over CLI and MCP before any RPC, on every direct network", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new EvmTestRpc(), mcp = await mcpClient(t, temporary.root, rpc);
  const base = { profile: "default", chain: BASE, asset: "native", rpc_url: "https://rpc.example", to: EVM_REQUEST.recipient, amount: "0.000001",
    max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: "direct-gate-unlisted-0001" };
  const cases: readonly [Record<string, string>, string][] = [
    [{ chain: "eip155:11155111" }, "allowlist_network_unlisted"],
    [{ asset: EVM_TOKEN }, "allowlist_asset_unlisted"],
    [{ chain: "eip155:1", asset: EVM_USDC[8453] }, "allowlist_asset_unlisted"],
    [{ asset: EVM_USDC[8453], decimals: "18" }, "allowlist_decimals_mismatch"],
    [{ chain: "eip155:10", asset: EVM_USDC[8453] }, "allowlist_asset_unlisted"],
    [{ chain: "eip155:137", asset: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" }, "allowlist_asset_unlisted"],
    [{ chain: "eip155:56", asset: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" }, "allowlist_asset_unlisted"],
    [{ chain: "eip155:43114", asset: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: "18" }, "allowlist_decimals_mismatch"],
  ];
  for (const [override, reason] of cases) {
    const input = { ...base, ...override };
    const argv = ["pay", "transfer", "prepare-asset", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
    const cli = await runCli(argv, {}, { stateRoot: temporary.root, rpc }), viaMcp = await mcp(input);
    assert.equal(cli.error?.code, "APN_ALLOWLIST_REFUSED", reason); assert.equal(cli.error?.details?.reason, reason);
    assert.deepEqual(viaMcp.error, cli.error, reason);
  }
  assert.equal(rpc.genericBalanceCalls, 0); assert.equal(rpc.submissions.length, 0);
});

test("without an active owner policy, direct EVM prepare refuses before RPC over core, CLI and MCP; revoked, expired, other-account and tampered policies fail closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await setup.core.wallet.ensure("default") as { address: Address };
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), refused("allowlist_policy_required"));
  const input = { profile: "default", chain: BASE, asset: "native", rpc_url: "https://rpc.example", to: EVM_REQUEST.recipient, amount: "0.000001",
    max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: "direct-gate-policy-0001" };
  const argv = ["pay", "transfer", "prepare-asset", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
  const cli = await runCli(argv, {}, { stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping });
  const viaMcp = await (await mcpClient(t, temporary.root, setup.rpc))(input);
  assert.equal(cli.error?.details?.reason, "allowlist_policy_required"); assert.deepEqual(viaMcp.error, cli.error);
  assert.deepEqual(cli.next_actions, ["apn allowlist policy status --profile default"]);
  assert.equal(setup.rpc.genericBalanceCalls, 0);

  const now = setup.clock.now();
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now, admissions: [directAdmission(BASE, EVM_USDC[8453])],
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), refused("allowlist_direct_not_admitted"));
  await revokeDirectPolicy(temporary.root, "default", now);
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), refused("allowlist_policy_required"));
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now, admissions: [directAdmission(BASE, null)],
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
  setup.clock.value = new Date(now.getTime() + 7_200_000);
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), refused("allowlist_policy_expired"));
  setup.clock.value = now;
  const directory = join(temporary.root, "allowlist-activations");
  const [profileDirectory] = await readdir(directory);
  const entry = join(directory, profileDirectory!, "e00000003.json");
  await writeFile(entry, (await readFile(entry, "utf8")).replace(/"decidedAt":"[^"]+"/u, `"decidedAt":"${new Date(now.getTime() - 1).toISOString()}"`), { mode: 0o600 });
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), { code: "APN_STATE_CORRUPT" });
  assert.equal(setup.rpc.genericBalanceCalls, 0);

  const other = await temporaryState(); t.after(other.cleanup);
  const stranger = evmCore(other.root); await stranger.core.wallet.ensure("default");
  await activateDirectPolicy(other.root, "default", { accounts: { evm: "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1" }, now: stranger.clock.now(), admissions: [directAdmission(BASE, null)] });
  await assert.rejects(stranger.core.transfer.prepare(EVM_REQUEST), refused("allowlist_account_mismatch"));
  assert.equal(stranger.rpc.genericBalanceCalls, 0);
});

test("owner caps bind native ETH: per-operation and daily refusals count the shared usage ledger, and completion consumes the lease", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = await owner(temporary.root);
  await assert.rejects(setup.core.transfer.prepare(eth("0.0013", "eth-cap-per-op-0001")), refused("allowlist_per_transfer_cap_exceeded"));
  for (const index of [1, 2, 3]) {
    const prepared = await setup.core.transfer.prepare(eth("0.0012", `eth-cap-daily-000${index}`)) as { operation_id: string; allowlist: { policy_digest: string } };
    assert.equal(prepared.allowlist.policy_digest, setup.policy.policyDigest);
    assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
  }
  assert.equal(await directUsage(temporary.root, setup.wallet.address, BASE, null, setup.clock.now()), "3600000000000000");
  await assert.rejects(setup.core.transfer.prepare(eth("0.0005", "eth-cap-daily-0004")), (error: unknown) => refused("allowlist_daily_cap_exceeded")(error) &&
    (error as ApnError).details?.daily_usage_atomic === "3600000000000000");
  const last = await setup.core.transfer.prepare(eth("0.0004", "eth-cap-daily-0005")) as { state: string };
  assert.equal(last.state, "awaiting_approval");
  assert.equal(setup.rpc.submissions.length, 3);
});

test("the usage lease is in the journal and the ledger before the signer runs, and the public operation names it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let observed: { journal: OperationRecord; state: string | undefined } | undefined;
  const setup = evmCore(temporary.root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
    if (request.operation === "directTransfer.approveAndSign") {
      const journal = (await setup.state.findOperation((request.payload as { operationId: string }).operationId))!;
      const lease = journal.allowlistLease!;
      observed = { journal, state: (await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state };
    }
    return await native.request(request);
  } }));
  const wallet = await setup.core.wallet.ensure("default") as { address: Address }; setup.rpc.sender = wallet.address;
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(), admissions: [directAdmission(BASE, null, ETH_CAPS)] });
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string; allowlist: { reservation_id: string | null } };
  assert.equal(prepared.allowlist.reservation_id, null);
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string; allowlist: { reservation_id: string } };
  assert.equal(observed?.journal.state, "started"); assert.equal(observed?.state, "reserved");
  assert.equal(observed?.journal.allowlistLease?.reservation.amountAtomic, "1000000000000");
  assert.equal(approved.state, "completed"); assert.equal(approved.allowlist.reservation_id, observed?.journal.allowlistLease?.reservation.reservationId);
  const lease = observed!.journal.allowlistLease!;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state, "finalized");
  assert.equal(await directUsage(temporary.root, wallet.address, BASE, null, setup.clock.now()), "1000000000000");
});

test("a declined approval is released by resume, a confirmed revert releases, and an unknown outcome stays charged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new EvmApproval(); approval.rejection = new ApnError("APN_OPERATION_BLOCKED", "declined");
  const declined = evmCore(temporary.root, new EvmTestRpc(), new EvmWrappingSecret(), approval);
  const wallet = await declined.core.wallet.ensure("default") as { address: Address };
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: declined.clock.now(), admissions: [directAdmission(BASE, null, ETH_CAPS)] });
  const usage = async () => await directUsage(temporary.root, wallet.address, BASE, null, declined.clock.now());
  const first = await declined.core.transfer.prepare(eth("0.001", "eth-release-declined")) as { operation_id: string };
  await assert.rejects(declined.core.transfer.approve(first.operation_id), /declined/u);
  assert.equal(await usage(), "1000000000000000");
  await assert.rejects(evmCore(temporary.root, declined.rpc, declined.wrapping).core.transfer.resume(first.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal(await usage(), "0");

  const setup = evmCore(temporary.root, declined.rpc, declined.wrapping); setup.rpc.sender = wallet.address; setup.rpc.receiptStatus = "reverted";
  const reverted = await setup.core.transfer.prepare(eth("0.001", "eth-release-reverted")) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(reverted.operation_id) as { state: string }).state, "failed_confirmed_revert");
  assert.equal(await usage(), "0");

  setup.rpc.receiptStatus = "success"; setup.rpc.submitError = new Error("timeout"); setup.rpc.receiptEnabled = false;
  const unknown = await setup.core.transfer.prepare(eth("0.001", "eth-release-unknown")) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(unknown.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(await usage(), "1000000000000000");
  await assert.rejects(setup.core.transfer.prepare(eth("0.001", "eth-release-other")), { code: "APN_OPERATION_BLOCKED" });
  setup.rpc.submitError = null; setup.rpc.receiptEnabled = true;
  assert.equal((await setup.core.transfer.resume(unknown.operation_id) as { state: string }).state, "completed");
  assert.equal(await usage(), "1000000000000000");
});

test("an interrupted approval replays its reservation instead of reserving twice; a changed policy ends the operation before effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = await owner(temporary.root);
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const gate = new DirectAllowlistGate({ state: { root: temporary.root }, clock: setup.clock });
  const orphan = await gate.reserve(evmAllowlistSubject(operation), operation.allowlist);
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
  const stored = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(stored.allowlistLease?.reservation.reservationId, orphan.reservation.reservationId);
  const buckets = await readdir(join(temporary.root, "asset-usage"));
  assert.equal(buckets.length, 1); assert.equal((await readdir(join(temporary.root, "asset-usage", buckets[0]!))).length, 1);
  assert.equal(await directUsage(temporary.root, setup.wallet.address, BASE, null, setup.clock.now()), "1000000000000");
  await setup.core.transfer.resume(prepared.operation_id);
  assert.equal((await readdir(join(temporary.root, "asset-usage", buckets[0]!))).length, 1);

  const next = await setup.core.transfer.prepare(eth("0.000002", "eth-policy-changed")) as { operation_id: string };
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: setup.wallet.address }, now: setup.clock.now(),
    admissions: [directAdmission(BASE, null, { maximumPerTransferAtomic: "1000000000000000", dailyLimitAtomic: "4000000000000000" })] });
  await assert.rejects(setup.core.transfer.approve(next.operation_id), refused("allowlist_policy_changed"));
  const ended = (await setup.state.findOperation(next.operation_id))!;
  assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.reason, "allowlist_refused_at_approval");
  assert.equal(ended.allowlistLease, undefined); assert.equal(setup.approval.intents.length, 1); assert.equal(setup.rpc.submissions.length, 1);
});

test("a record written before the gate still validates, reads and resumes, but approval refuses it before any signature", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = await owner(temporary.root);
  const legacy = async (key: string, started: boolean): Promise<string> => {
    const prepared = await setup.core.transfer.prepare(eth("0.000001", key)) as { operation_id: string };
    const { allowlist: _binding, integrityHash: _hash, ...body } = (await setup.state.findOperation(prepared.operation_id))!;
    const transitions = started ? appendTransition(body.transitions, { at: setup.clock.now().toISOString(), state: "started", terminal: false,
      reason: "foreground_signing_started", proofClass: "durable_pre_effect" }) : body.transitions;
    const record = sealOperation({ ...body, transitions, ...(started ? { state: "started", reason: "foreground_signing_started" } : {}) });
    await writeFile(join(temporary.root, "operations", record.profileHash, `${record.operationId}.json`), `${canonicalJson(record)}\n`, { mode: 0o600 });
    return record.operationId;
  };
  const waiting = await legacy("eth-legacy-waiting", false);
  const status = await setup.core.transfer.status(waiting) as Record<string, unknown>;
  assert.equal(status.state, "awaiting_approval"); assert.equal("allowlist" in status, false);
  await assert.rejects(setup.core.transfer.approve(waiting), refused("allowlist_binding_missing"));
  assert.equal((await setup.state.findOperation(waiting))!.state, "failed_before_effect");
  assert.equal(setup.approval.intents.length, 0); assert.equal(setup.rpc.submissions.length, 0);
  const interrupted = await legacy("eth-legacy-started", true);
  await assert.rejects(setup.core.transfer.resume(interrupted), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await setup.state.findOperation(interrupted))!.state, "failed_before_effect");
  assert.equal(await directUsage(temporary.root, setup.wallet.address, BASE, null, setup.clock.now()), "0");
});
