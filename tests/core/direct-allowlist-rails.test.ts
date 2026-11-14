import assert from "node:assert/strict";
import { chmod, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { loadActiveAssetPolicyRegistry } from "../../src/allowlist-active-policy.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { chainAsset, SOLANA_USDT } from "../../src/chain-policy.js";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { DIRECT_ALLOWLIST_SCHEMA, DirectAllowlistGate, requireListedDirectAsset, type DirectAllowlistSubject } from "../../src/direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "../../src/direct-asset-usage.js";
import type { DirectRailPort } from "../../src/direct-rail-ports.js";
import { ApnError } from "../../src/errors.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { requireListedRailAsset } from "../../src/rail-direct-allowlist.js";
import { railReservationFailureReason } from "../../src/rail-operation-lifecycle.js";
import { newRailOperation, transitionRail, type RailOperationRecord } from "../../src/rail-operation-model.js";
import { SOLANA_CHAIN, TRON_CHAIN, activateDirectPolicy, directAdmission, directUsage, reserveRailLease, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";
import { TRON_RECIPIENT, tronFixture } from "./tron-helpers.js";
import { findStored } from "./stored-operations.js";

const refusal = (result: OutputEnvelope, reason: string) => {
  assert.equal(result.error?.code, "APN_ALLOWLIST_REFUSED", JSON.stringify(result.error)); assert.equal(result.error?.details?.reason, reason);
};
type Fixture = Awaited<ReturnType<typeof tronFixture>> | Awaited<ReturnType<typeof solanaFixture>>;

/** Records the journal and ledger state at the instant custody is asked to sign. */
function observeSigning(root: string, s: Fixture): () => { state: string; lease: DirectAssetUsageLease | undefined; ledger: string | undefined } | undefined {
  let observed: { state: string; lease: DirectAssetUsageLease | undefined; ledger: string | undefined } | undefined;
  const adapter = s.adapter as unknown as DirectRailPort, sign = adapter.sign.bind(adapter);
  const observe = async (binding: Parameters<DirectRailPort["sign"]>[0]) => {
    const journal = (await findStored(s.core.rails.records, binding.operationId))!, lease = journal.allowlistLease;
    observed = { state: journal.state, lease, ledger: lease === undefined ? undefined
      : (await new AssetUsageLedger(root).load(lease.reservation, lease.reservation.reservationId))?.state };
  };
  adapter.sign = async (binding) => {
    await observe(binding);
    return await sign(binding);
  };
  if (adapter.sealRevalidated !== undefined) {
    const seal = adapter.sealRevalidated.bind(adapter);
    adapter.sealRevalidated = async (binding) => { await observe(binding); return await seal(binding); };
  }
  return () => observed;
}

/** A prior direct approval on the same account and asset: the shared ledger counts it against today's cap. */
async function seedUsage(root: string, s: Fixture, chain: string, amountAtomic: string, now: Date): Promise<void> {
  const active = (await loadActiveAssetPolicyRegistry(root, s.account.profile, now))!;
  const subject: DirectAllowlistSubject = { profile: s.account.profile, operationId: "a".repeat(64), family: s.account.rail, account: s.account.address,
    chain, asset: { kind: "native", identifier: null }, amountAtomic, recipient: "seeded-usage-recipient" };
  await new DirectAllowlistGate({ state: { root }, clock: { now: () => new Date(now) } })
    .reserve(subject, { schemaVersion: DIRECT_ALLOWLIST_SCHEMA, policyDigest: active.digest, policyRevision: active.revision });
}

test("every TRON and Solana alias resolves on the frozen list; unlisted networks and token identities are refused", () => {
  for (const [rail, alias] of [["tron", "trx"], ["tron", "usdt"], ["solana", "sol"], ["solana", "usdc"], ["solana", "usdt"]] as const) requireListedRailAsset(chainAsset(rail, alias));
  const reason = (reasonName: string) => (error: unknown) => (error as { code?: string; details?: { reason?: string } }).code === "APN_ALLOWLIST_REFUSED" &&
    (error as { details: { reason: string } }).details.reason === reasonName;
  assert.throws(() => requireListedDirectAsset(`tron:${"1".repeat(64)}`, { kind: "native", identifier: null }), reason("allowlist_network_unlisted"));
  assert.throws(() => requireListedDirectAsset(TRON_CHAIN, { kind: "token", identifier: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" }), reason("allowlist_asset_unlisted"));
  assert.throws(() => requireListedDirectAsset("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", { kind: "native", identifier: null }), reason("allowlist_network_unlisted"));
  assert.throws(() => requireListedDirectAsset(SOLANA_CHAIN, { kind: "token", identifier: "So11111111111111111111111111111111111111112" }), reason("allowlist_asset_unlisted"));
});

test("TRON and Solana refuse without an active owner policy, identically over CLI and MCP, before any RPC", async (t) => {
  for (const rail of ["tron", "solana"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = rail === "tron" ? await tronFixture(temporary.root, { admit: false }) : await solanaFixture(temporary.root, { admit: false });
    const fee = rail === "tron" ? { name: "max_fee_trx", value: "30" } : { name: "max_fee_sol", value: "0.003" };
    const asset = rail === "tron" ? "trx" : "sol";
    const admitted = await s.core.execute(rail === "tron"
      ? { command: "policy.admit-tron", profile: s.account.profile, asset: "trx", maximumPerTransfer: "2", dailyLimit: "3", maximumFee: fee.value }
      : { command: "policy.admit-solana", profile: s.account.profile, asset: "sol", maximumPerTransfer: "2", dailyLimit: "3", maximumFee: fee.value });
    assert.equal(admitted.ok, true, admitted.error?.message);
    const calls = s.rpc.calls.length, clock = { now: () => new Date(s.now) };
    const input = { profile: s.account.profile, asset, to: rail === "tron" ? TRON_RECIPIENT : SOL_RECIPIENT, amount: "1", [fee.name]: fee.value,
      idempotency_key: `${rail}-gate-policy-0001` };
    const argv = ["pay", "transfer", `prepare-${rail}`, ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
    const cli = await runCli(argv, {}, { stateRoot: temporary.root, chainAccounts: s.storage, directRails: [s.adapter as unknown as DirectRailPort], wrappingSecret: s.wrapping, clock });
    const server = createMcpServer({ stateRoot: temporary.root, chainAccounts: s.storage, directRails: [s.adapter as unknown as DirectRailPort], wrappingSecret: s.wrapping, clock });
    const client = new Client({ name: "direct-allowlist-rails", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a); t.after(async () => { await client.close(); await server.close(); });
    const viaMcp = (await client.callTool({ name: `apn_pay_transfer_prepare_${rail}`, arguments: input })).structuredContent as unknown as OutputEnvelope;
    refusal(cli, "allowlist_policy_required"); assert.deepEqual(viaMcp.error, cli.error, rail);
    assert.equal(s.rpc.calls.length, calls, rail); assert.equal(s.approval.calls.length, 0, rail);
  }
});

test("TRX owner caps refuse per operation and per day against the shared ledger; the lease is durable at signing_started and finalized on completion", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await tronFixture(temporary.root), observed = observeSigning(temporary.root, s);
  const prepare = async (amount: string, idempotencyKey: string) => await s.core.execute({ command: "transfer.prepare-tron", profile: s.account.profile,
    asset: "trx", recipient: TRON_RECIPIENT, amount, maximumFee: "30", idempotencyKey });
  refusal(await prepare("2.5", "tron-cap-per-op-0001"), "allowlist_per_transfer_cap_exceeded");
  await seedUsage(temporary.root, s, TRON_CHAIN, "2000000", s.now);
  refusal(await prepare("1.5", "tron-cap-daily-0001"), "allowlist_daily_cap_exceeded");
  const prepared = await prepare("1", "tron-cap-daily-0002"); assert.equal(prepared.ok, true, prepared.error?.message);
  const id = (prepared.operation as { operation_id: string }).operation_id; s.rpc.prepared = (await findStored(s.core.rails.records, id))!.prepared;
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  const atSigning = observed()!; assert.equal(atSigning.state, "signing_started"); assert.equal(atSigning.ledger, "reserved");
  assert.equal(atSigning.lease?.reservation.amountAtomic, "1000000");
  const record = (await findStored(s.core.rails.records, id))!;
  assert.deepEqual(s.approval.allowlistBindings, [record.allowlist]);
  const lease = record.allowlistLease!;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state, "finalized");
  assert.equal((approved.operation as { allowlist: { reservation_id: string } }).allowlist.reservation_id, lease.reservation.reservationId);
  assert.equal(await directUsage(temporary.root, s.account.address, TRON_CHAIN, null, s.now), "3000000");
});

test("the TRX chain policy's admitted principal caps are enforced beside the allowlist caps, before any RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await tronFixture(temporary.root);
  const admitted = await s.core.execute({ command: "policy.admit-tron", profile: s.account.profile, asset: "trx", maximumPerTransfer: "1", dailyLimit: "1.5", maximumFee: "30" });
  assert.equal(admitted.ok, true, admitted.error?.message);
  const prepare = async (amount: string, idempotencyKey: string) => await s.core.execute({ command: "transfer.prepare-tron", profile: s.account.profile,
    asset: "trx", recipient: TRON_RECIPIENT, amount, maximumFee: "30", idempotencyKey });
  const calls = s.rpc.calls.length;
  const over = await prepare("1.5", "tron-chain-cap-0001");
  assert.equal(over.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(over.error?.details?.reason, "chain_policy_per_transfer_cap_exceeded");
  assert.equal(s.rpc.calls.length, calls, "refused before any RPC read");
  const first = await prepare("1", "tron-chain-cap-0002"); assert.equal(first.ok, true, first.error?.message);
  const id = (first.operation as { operation_id: string }).operation_id; s.rpc.prepared = (await findStored(s.core.rails.records, id))!.prepared;
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  const daily = await prepare("1", "tron-chain-cap-0003");
  assert.equal(daily.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(daily.error?.details?.reason, "chain_policy_daily_limit_exceeded");
});

test("a TRON effect refused after signing but before its first send releases the lease; an interrupted approval replays its reservation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await tronFixture(temporary.root);
  const adapter = s.adapter as unknown as DirectRailPort, sign = adapter.sign.bind(adapter);
  adapter.sign = async (binding) => { const effect = await sign(binding); await revokeDirectPolicy(temporary.root, s.account.profile, new Date(s.now)); return effect; };
  const id = await s.prepare("trx", "tron-release-0001");
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id });
  const ended = (await findStored(s.core.rails.records, id))!;
  assert.equal((approved.operation as { state: string }).state, "failed_before_effect"); assert.equal(ended.reason, "never_submitted_frozen_effect_no_longer_valid");
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await new AssetUsageLedger(temporary.root).load(ended.allowlistLease!.reservation, ended.allowlistLease!.reservation.reservationId))?.state, "failed_before_effect");
  assert.equal(await directUsage(temporary.root, s.account.address, TRON_CHAIN, null, s.now), "0");

  const other = await temporaryState(); t.after(other.cleanup);
  const replay = await tronFixture(other.root); const replayId = await replay.prepare("trx", "tron-replay-0001");
  const record = (await findStored(replay.core.rails.records, replayId))!;
  const orphan = await reserveRailLease(other.root, replay.now, record);
  const result = await replay.core.execute({ command: "transfer.approve", operationId: replayId }); assert.equal(result.ok, true, result.error?.message);
  assert.equal((await findStored(replay.core.rails.records, replayId))!.allowlistLease?.reservation.reservationId, orphan.reservation.reservationId);
  const buckets = await readdir(join(other.root, "asset-usage"));
  assert.equal(buckets.length, 1); assert.equal((await readdir(join(other.root, "asset-usage", buckets[0]!))).length, 1);
  await replay.core.execute({ command: "operation.resume", operationId: replayId });
  assert.equal((await readdir(join(other.root, "asset-usage", buckets[0]!))).length, 1);
  assert.equal(await directUsage(other.root, replay.account.address, TRON_CHAIN, null, replay.now), "1");
});

test("a TRON record written before the gate still validates and reads; approving it is refused before the owner screen or any signature", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await tronFixture(temporary.root); const id = await s.prepare("trx", "tron-legacy-0001");
  const gated: RailOperationRecord = (await findStored(s.core.rails.records, id))!;
  const legacy = newRailOperation({ schemaVersion: gated.schemaVersion, kind: gated.kind, operationId: gated.operationId, profile: gated.profile,
    profileHash: gated.profileHash, idempotencyHash: gated.idempotencyHash, requestHash: gated.requestHash, account: gated.account,
    prepared: gated.prepared, policyHash: gated.policyHash });
  await unlink(join(temporary.root, "rail-operations", gated.profileHash, `${id}.json`));
  await s.core.rails.records.persist(legacy);
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal("allowlist" in (status.operation as object), false);
  refusal(await s.core.execute({ command: "transfer.approve", operationId: id }), "allowlist_binding_missing");
  assert.equal((await findStored(s.core.rails.records, id))!.state, "failed_before_effect");
  assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 0);
});

test("SOL owner caps refuse per operation and per day; the Solana lease is durable before custody signs and finalized on completion", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await solanaFixture(temporary.root), observed = observeSigning(temporary.root, s);
  const prepare = async (amount: string, idempotencyKey: string) => await s.core.execute({ command: "transfer.prepare-solana", profile: s.account.profile,
    asset: "sol", recipient: SOL_RECIPIENT, amount, maximumFee: "0.003", idempotencyKey });
  refusal(await prepare("2.5", "solana-cap-per-op-0001"), "allowlist_per_transfer_cap_exceeded");
  await seedUsage(temporary.root, s, SOLANA_CHAIN, "2000000000", s.now);
  refusal(await prepare("1.5", "solana-cap-daily-0001"), "allowlist_daily_cap_exceeded");
  const id = await s.prepare("sol", "solana-cap-daily-0002");
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  assert.equal(observed()?.state, "signing_started"); assert.equal(observed()?.ledger, "reserved");
  const record = (await findStored(s.core.rails.records, id))!;
  assert.deepEqual(s.approval.allowlistBindings, [record.allowlist]);
  const lease = record.allowlistLease!;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state, "finalized");
  assert.equal(await directUsage(temporary.root, s.account.address, SOLANA_CHAIN, null, s.now), "2000001000");
});

test("Solana USDT uses its pinned mint beside USDC: CLI and MCP bind it, owner caps apply, and it completes with the lease finalized", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await solanaFixture(temporary.root); await s.rpc.useMint(SOLANA_USDT);
  const input = { profile: s.account.profile, asset: "usdt", to: SOL_RECIPIENT, amount: "1.25", max_fee_sol: "0.003", idempotency_key: "solana-usdt-bind-0001" };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_solana")!;
  const argv = ["pay", "transfer", "prepare-solana", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  const balance = await s.core.execute({ command: "wallet.balance-solana", profile: s.account.profile, asset: "usdt" });
  assert.equal(balance.ok, true, balance.error?.message);
  const admitted = await s.core.execute({ command: "policy.admit-solana", profile: s.account.profile, asset: "usdt", maximumPerTransfer: "2", dailyLimit: "3", maximumFee: "0.003" });
  assert.equal(admitted.ok, true, admitted.error?.message);
  const prepare = async (amount: string, idempotencyKey: string) => await s.core.execute({ command: "transfer.prepare-solana", profile: s.account.profile,
    asset: "usdt", recipient: SOL_RECIPIENT, amount, maximumFee: "0.003", idempotencyKey });
  refusal(await prepare("1", "solana-usdt-0001"), "allowlist_direct_not_admitted");
  await activateDirectPolicy(temporary.root, s.account.profile, { accounts: { solana: s.account.address }, now: s.now,
    admissions: [directAdmission(SOLANA_CHAIN, SOLANA_USDT, { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000" })] });
  refusal(await prepare("3.5", "solana-usdt-0002"), "allowlist_per_transfer_cap_exceeded");
  const prepared = await prepare("1.25", "solana-usdt-0003"); assert.equal(prepared.ok, true, prepared.error?.message);
  const id = (prepared.operation as { operation_id: string }).operation_id;
  const record = (await findStored(s.core.rails.records, id))!; s.rpc.prepared = record.prepared;
  assert.equal(record.prepared.asset.identifier, SOLANA_USDT); assert.equal(record.prepared.sourceTokenAccount, s.rpc.sourceAta);
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  const lease = (await findStored(s.core.rails.records, id))!.allowlistLease!;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state, "finalized");
  assert.equal(await directUsage(temporary.root, s.account.address, SOLANA_CHAIN, SOLANA_USDT, s.now), "1250000");
});

test("a usage-ledger state failure at approval ends a TRON or Solana transfer before signing under its own cause, not as an allowlist refusal", async (t) => {
  for (const rail of ["tron", "solana"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    let s: Fixture, id: string;
    if (rail === "tron") { const fixture = await tronFixture(temporary.root); s = fixture; id = await fixture.prepare("trx", "tron-reserve-security-0001"); }
    else { const fixture = await solanaFixture(temporary.root); s = fixture; id = await fixture.prepare("sol", "solana-reserve-security-0001"); }
    // Prepare created the ledger directory; opening it to the group makes every ledger read refuse with APN_STATE_SECURITY.
    const usage = join(temporary.root, "asset-usage");
    await chmod(usage, 0o750);
    const approved = await s.core.execute({ command: "transfer.approve", operationId: id });
    await chmod(usage, 0o700);
    assert.equal(approved.error?.code, "APN_STATE_SECURITY", rail);
    const ended = (await findStored(s.core.rails.records, id))!;
    assert.equal(ended.state, "failed_before_effect", rail); assert.equal(ended.reason, "usage_reservation_apn_state_security", rail);
    assert.equal(ended.allowlistLease, undefined, rail);
    assert.equal(ended.transitions.some((entry) => entry.state === "signing_started"), false, rail);
    assert.equal(s.rpc.submissions.length, 0, rail);
    assert.equal(await directUsage(temporary.root, s.account.address, rail === "tron" ? TRON_CHAIN : SOLANA_CHAIN, null, s.now), "0", rail);
    const status = await s.core.execute({ command: "operation.status", operationId: id });
    assert.equal(status.ok, true, status.error?.message);
    assert.equal((status.operation as { reason: string }).reason, "usage_reservation_apn_state_security", rail);
  }
});

test("a TRON owner-cap refusal at the reservation keeps the allowlist reason; a reserve failure an older release saved under it still reads unchanged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await tronFixture(temporary.root);
  const prepared = await s.core.execute({ command: "transfer.prepare-tron", profile: s.account.profile, asset: "trx", recipient: TRON_RECIPIENT,
    amount: "1.5", maximumFee: "30", idempotencyKey: "tron-reserve-cap-0001" });
  assert.equal(prepared.ok, true, prepared.error?.message);
  const id = (prepared.operation as { operation_id: string }).operation_id; s.rpc.prepared = (await findStored(s.core.rails.records, id))!.prepared;
  // Another approval reserved on the same account and asset after this preparation; only the reservation sees today's total.
  await seedUsage(temporary.root, s, TRON_CHAIN, "2000000", s.now);
  refusal(await s.core.execute({ command: "transfer.approve", operationId: id }), "allowlist_daily_cap_exceeded");
  const ended = (await findStored(s.core.rails.records, id))!;
  assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.reason, "allowlist_refused_at_approval");
  assert.equal(ended.allowlistLease, undefined); assert.equal(s.rpc.submissions.length, 0);

  // 0.5.106 and earlier saved every reserve failure, a ledger state failure included, as this exact transition.
  const legacyId = await s.prepare("trx", "tron-reserve-legacy-0001");
  const open = (await findStored(s.core.rails.records, legacyId))!;
  await s.core.rails.records.persist(transitionRail(open, { state: "failed_before_effect", at: new Date(s.now).toISOString(),
    reason: "allowlist_refused_at_approval", proofClass: "durable_pre_effect" }));
  const saved = (await findStored(s.core.rails.records, legacyId))!;
  const status = await s.core.execute({ command: "operation.status", operationId: legacyId });
  assert.equal(status.ok, true, status.error?.message); assert.equal((status.operation as { reason: string }).reason, "allowlist_refused_at_approval");
  const receipt = await s.core.execute({ command: "receipt.get", operationId: legacyId });
  assert.equal(receipt.ok, true, receipt.error?.message); assert.equal((receipt.receipt as { reason: string }).reason, "allowlist_refused_at_approval");
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: legacyId })).ok, true);
  assert.deepEqual(await findStored(s.core.rails.records, legacyId), saved);
});

test("only the allowlist's own refusal is recorded as allowlist_refused_at_approval; every other reserve failure names its cause", () => {
  assert.equal(railReservationFailureReason(new ApnError("APN_ALLOWLIST_REFUSED", "refused", { reason: "allowlist_daily_cap_exceeded" })), "allowlist_refused_at_approval");
  assert.equal(railReservationFailureReason(new ApnError("APN_STATE_SECURITY", "unsafe")), "usage_reservation_apn_state_security");
  assert.equal(railReservationFailureReason(new ApnError("APN_STATE_CORRUPT", "corrupt")), "usage_reservation_apn_state_corrupt");
  assert.equal(railReservationFailureReason(new ApnError("APN_STATE_BUSY", "busy")), "usage_reservation_apn_state_busy");
  assert.equal(railReservationFailureReason(new ApnError("APN_OPERATION_BLOCKED", "crossed")), "usage_reservation_apn_operation_blocked");
  assert.equal(railReservationFailureReason(new Error("EIO")), "usage_reservation_failed");
});
