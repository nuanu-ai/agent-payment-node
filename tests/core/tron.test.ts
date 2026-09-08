import assert from "node:assert/strict";
import test from "node:test";
import { utils } from "tronweb";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { chainAsset } from "../../src/chain-policy.js";
import { TronRpc } from "../../src/tron/rpc.js";
import { temporaryState } from "./helpers.js";
import { TRON_RECIPIENT, tronFixture } from "./tron-helpers.js";
import { tronAddress, tronHex, TRON_GENESIS } from "../../src/tron/codec.js";
import { validateTronEffect, validateTronChainTransaction } from "../../src/tron/transaction.js";
import { validateRailPrepared } from "../../src/rail-operation-model.js";

for (const asset of ["trx", "usdt"] as const) test(`TRON ${asset} completes the integrated exact signed and solidified journey with bounded fees`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare(asset);
  const initial = (await s.core.rails.records.findOperation(id))!;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message); const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.state, "completed"); assert.equal(s.rpc.submissions.length, 1); assert.equal(s.approval.calls.length, 1);
  assert.equal(record.evidence?.finality, "solidified"); assert.equal(record.evidence?.recipientEffectVerified, true);
  assert.equal(record.evidence?.resources?.balanceObservation.scope, "current_solidified_state");
  const effect = await s.storage.effect(s.account, id, initial.fingerprint); assert.ok(effect);
  const tx = validateTronEffect(initial.prepared, effect); assert.equal(tx.txID, effect.transactionId);
  const pb = utils.transaction.txJsonToPb(tx); pb.addSignature(Buffer.from(tx.signature![0]!, "hex"));
  assert.equal(BigInt(pb.serializeBinary().length + 64).toString(), initial.prepared.resources!.bandwidthBytesAtomic);
  const publicText = JSON.stringify(result);
  for (const secret of [effect.rawPayload, tx.raw_data_hex, tx.signature![0]!, "unsignedPayload", "rawPayload", "seedHex"]) assert.equal(publicText.includes(secret), false);
  assert.equal((await s.core.execute({ command: "receipt.get", operationId: id })).ok, true);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true); assert.equal(s.rpc.submissions.length, 1);
  assert.equal(await s.prepare(asset), id); assert.equal(s.rpc.submissions.length, 1);
});

test("TRON CLI and MCP bind the same exact six-decimal request and reject fallback assets and custody", () => {
  const input = { profile: "tron-test", asset: "usdt", to: TRON_RECIPIENT, amount: "1.25", max_fee_trx: "30", idempotency_key: "tron-parity-0001" };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_tron")!;
  assert.deepEqual(bindArgv(["pay", "transfer", "prepare-tron", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])]), bindMcpInput(tool.command, input));
  for (const amount of ["0", "-1", "+1", "1e3", " 1", "01", "1.0", "0.0000001"]) assert.throws(() => bindMcpInput(tool.command, { ...input, amount }), { code: "APN_INVALID_INPUT" });
  for (const asset of ["USDT", "usdc", "sol", "native", ""]) assert.throws(() => bindMcpInput(tool.command, { ...input, asset }), { code: "APN_INVALID_INPUT" });
  const ensure = MCP_TOOLS.find((entry) => entry.name === "apn_wallet_ensure_tron")!;
  for (const args of [{ profile: "tron-test", provider: "local" }, { profile: "tron-test", provider: "coinbase-awal", accept_risk: "true" }, { profile: "tron-test", provider: "local", accept_risk: "false" }]) assert.throws(() => bindMcpInput(ensure.command, args), { code: "APN_INVALID_INPUT" });
});

test("TRON chain, protocol, permission, funding, asset and resource refusals have zero signing or submission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
  const request = { command: "transfer.prepare-tron", profile: s.account.profile, asset: "usdt", recipient: TRON_RECIPIENT, amount: "1", maximumFee: "30", idempotencyKey: "tron-negative-0001" } as const;
  const loads = s.wrapping.loads;
  const check = async (code: string) => { const result = await s.core.execute(request); assert.equal(result.error?.code, code); assert.equal(s.rpc.submissions.length, 0); assert.equal(s.approval.calls.length, 0); assert.equal(s.wrapping.loads, loads); assert.equal((await s.core.rails.records.listOperations(s.account.profileHash)).length, 0); };
  s.rpc.genesis = "00".repeat(32); await check("APN_CHAIN_MISMATCH"); s.rpc.genesis = TRON_GENESIS;
  s.rpc.version = "future"; await check("APN_PROVIDER_CAPABILITY_UNAVAILABLE"); s.rpc.version = "4.8.2.1";
  s.rpc.senderExists = false; await check("APN_OPERATION_BLOCKED"); s.rpc.senderExists = true;
  s.rpc.senderContract = true; await check("APN_WALLET_MISMATCH"); s.rpc.senderContract = false;
  s.rpc.badPermission = true; await check("APN_WALLET_MISMATCH"); s.rpc.badPermission = false;
  s.rpc.wrongDecimals = true; await check("APN_ASSET_MISMATCH"); s.rpc.wrongDecimals = false;
  s.rpc.simulationFailure = true; await check("APN_OPERATION_BLOCKED"); s.rpc.simulationFailure = false;
  s.rpc.native = 1n; await check("APN_INSUFFICIENT_GAS"); s.rpc.native = 200_000_000n;
  s.rpc.token = 1n; await check("APN_INSUFFICIENT_ASSET"); s.rpc.token = 9_000_000n;
  s.rpc.energyEstimate = 1_000_000n; s.rpc.energyStaked = 1_000_000n; await check("APN_FEE_BUDGET_EXCEEDED"); s.rpc.energyEstimate = 65_000n;
  s.rpc.headOffsetMs = -60_001; await check("APN_REPREPARE_REQUIRED"); s.rpc.headOffsetMs = 6001; await check("APN_REPREPARE_REQUIRED"); s.rpc.headOffsetMs = 0;
  s.rpc.maintenance = BigInt(s.now.getTime() + 15_000); await check("APN_REPREPARE_REQUIRED");
});

test("TRON native activation cap covers both special creation and a recipient activated after preparation", async (t) => {
  for (const alreadyActive of [false, true]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
    s.rpc.destinationExists = alreadyActive;
    const id = await s.prepare("trx", "tron-activation-0001", alreadyActive ? "0.4" : "1.1");
    const prepared = (await s.core.rails.records.findOperation(id))!.prepared;
    assert.equal(prepared.resources!.costRule, alreadyActive ? "ordinary_bandwidth" : "native_activation_or_bandwidth");
    if (!alreadyActive) { assert.equal(prepared.resources!.totalFeeMaximumAtomic, "1100000"); s.rpc.destinationExists = true; }
    const result = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
    const final = (await s.core.rails.records.findOperation(id))!; assert.equal(final.state, "completed");
    assert.equal(final.evidence!.resources!.accountActivationFeeAtomic, "0");
    assert.ok(BigInt(final.evidence!.actualNetworkFeeAtomic) <= BigInt(prepared.resources!.totalFeeMaximumAtomic));
  }
});

for (const asset of ["trx", "usdt"] as const) test(`TRON ${asset} accepts protocol zero omissions and exact staked resource accounting`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
  s.rpc.explicitDefaults = true; s.rpc.bandwidthResource = true;
  if (asset === "usdt") { s.rpc.energyStaked = 64_999n; s.rpc.originEnergy = 1n; }
  const id = await s.prepare(asset); const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message); const record = (await s.core.rails.records.findOperation(id))!; assert.equal(record.state, "completed");
  assert.equal(record.evidence!.actualNetworkFeeAtomic, asset === "trx" ? "1000000" : "0");
  assert.equal(record.evidence!.resources!.energyFeeAtomic, "0"); assert.equal(record.evidence!.resources!.bandwidthFeeAtomic, "0");
});

test("TRON evidence refuses wrong body, signature, block, fees, recipient logs, duplicate logs and unknown enums", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
  const id = await s.prepare("usdt"); s.rpc.solidified = false; await s.core.execute({ command: "transfer.approve", operationId: id }); s.rpc.solidified = true;
  const pending = async () => { const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "submitted_pending"); assert.equal(s.rpc.submissions.length, 1); };
  const sealed = s.rpc.submissions[0]!; const v = parseInt(sealed.signature![0]!.slice(-2), 16);
  const alias = sealed.signature![0]!.slice(0, -2) + (v < 27 ? v + 27 : v - 27).toString(16).padStart(2, "0");
  assert.equal(tronAddress(utils.crypto.ecRecover(sealed.txID, alias)), s.account.address, "the alias is a valid same-sender signature but differs from the sealed bytes");
  for (const field of ["badAmount", "badSignature", "badBlock", "badLog", "extraLog", "badParentHash", "signatureAlias"] as const) { s.rpc[field] = true; await pending(); s.rpc[field] = false; }
  s.rpc.feeExtra = 1n; await pending(); s.rpc.feeExtra = 0n;
  s.rpc.energyEstimate = 400_000n; s.rpc.energyStaked = 400_000n; await pending(); s.rpc.energyEstimate = 65_000n; s.rpc.energyStaked = 0n;
  s.rpc.transactionBlock = 999n; await pending(); s.rpc.transactionBlock = 1010n;
  s.rpc.parentTimeOverride = BigInt(s.rpc.initialTime + 121_000); s.rpc.inclusionTimeOverride = BigInt(s.rpc.initialTime + 122_000); await pending();
  s.rpc.parentTimeOverride = undefined; s.rpc.inclusionTimeOverride = undefined;
  for (const result of ["DEFAULT", "OUT_OF_ENERGY", "UNKNOWN", "SUCESS"]) { s.rpc.badResult = result; await pending(); } s.rpc.badResult = undefined;
  const complete = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal((complete.operation as { state: string }).state, "completed"); assert.equal(s.rpc.submissions.length, 1);
  const record = (await s.core.rails.records.findOperation(id))!; const tx = s.rpc.submissions[0]!;
  assert.equal(validateTronChainTransaction({ ...tx, signature: [tx.signature![0]!.toUpperCase()] }, record.prepared).signature![0], tx.signature![0]);
  for (const change of [
    { ...tx, signature: [...tx.signature!, tx.signature![0]!] },
    { ...tx, raw_data: { ...tx.raw_data, data: "00" } },
    { ...tx, raw_data: { ...tx.raw_data, contract: [...tx.raw_data.contract, tx.raw_data.contract[0]] } },
    { ...tx, raw_data: { ...tx.raw_data, contract: [{ ...tx.raw_data.contract[0], Permission_id: 2 }] } },
  ]) assert.throws(() => validateTronChainTransaction(change, record.prepared));
});

test("TRON solidified USDT REVERT accounts for fees without asserting delivered principal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare("usdt"); s.rpc.failed = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(result.ok, true);
  const record = (await s.core.rails.records.findOperation(id))!; assert.equal(record.state, "failed_confirmed_revert");
  assert.equal(record.evidence!.recipientEffectVerified, false); assert.equal(record.evidence!.senderEffectVerified, false); assert.equal(record.evidence!.resources!.contractResult, "REVERT");
  assert.ok(BigInt(record.evidence!.actualNetworkFeeAtomic) > 0n); await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(s.rpc.submissions.length, 1);
});

test("TRON finality binds the prior head expiry while accepting the first maintenance-crossing block after missed slots", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare("usdt");
  s.rpc.solidified = false; await s.core.execute({ command: "transfer.approve", operationId: id }); s.rpc.solidified = true;
  const prepared = (await s.core.rails.records.findOperation(id))!.prepared;
  const expiry = BigInt(prepared.resources!.expirationMsAtomic);
  s.rpc.parentTimeOverride = expiry - 1n; s.rpc.inclusionTimeOverride = s.rpc.maintenance + 3000n;
  s.rpc.headOffsetMs = 7_206_000; s.now.setTime(s.rpc.initialTime + 7_266_000);
  let result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal((result.operation as { state: string }).state, "submitted_pending");
  // Previous head + one normal slot equals expiration; the later block still
  // executes all transactions before applying maintenance proposals.
  s.rpc.parentTimeOverride = expiry - 3000n;
  result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal((result.operation as { state: string }).state, "completed"); assert.equal(s.rpc.submissions.length, 1);
});

test("TRON transport preserves int64 numbers and rejects unsafe endpoints, methods, payloads and unbounded evidence", async () => {
  let calls = 0; const fetcher = (async () => { calls++; return new Response('{"balance":9007199254740993}', { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  for (const url of [undefined, "http://rpc.example", "https://rpc.example/?key=test-only", "https://user:test-only@rpc.example", "https://rpc.example/#fragment", "https://rpc.example:8443", "https://127.0.0.1"]) await assert.rejects(new TronRpc(url, fetcher).call("wallet/getnowblock", {}), { code: "APN_RPC_CONFIG" });
  await assert.rejects(new TronRpc("https://rpc.example", fetcher).call("../arbitrary" as "wallet/getnowblock", {}), { code: "APN_RPC_CONFIG" }); assert.equal(calls, 0);
  await assert.rejects(new TronRpc("https://rpc.example", fetcher).call("wallet/getnowblock", { unsupported: "x".repeat(32_769) }), { code: "APN_RPC_PROTOCOL" }); assert.equal(calls, 0);
  assert.equal((await new TronRpc("https://rpc.example", fetcher).call("wallet/getaccount", {}) as { balance: bigint }).balance, 9007199254740993n);
  for (const payload of ['{"Error":"protected_response_canary"}', "not-json", "[]", "x".repeat(2_097_153)]) {
    const malformed = (async () => new Response(payload, { headers: { "content-type": "application/json" } })) as typeof fetch;
    await assert.rejects(new TronRpc("https://rpc.example", malformed).call("wallet/getnowblock", {}), (error: Error) => !error.message.includes("protected_response_canary"));
  }
  assert.equal(chainAsset("tron", "trx").decimals, 6); assert.equal(chainAsset("tron", "usdt").decimals, 6);
});

test("TRON checksum normalization binds the equivalent 41hex address and rejects EVM, bad checksum and corrupt resources", async (t) => {
  assert.equal(tronAddress(tronHex(TRON_RECIPIENT)), TRON_RECIPIENT);
  assert.throws(() => tronAddress(`0x${"11".repeat(20)}`), { code: "APN_INVALID_INPUT" });
  assert.throws(() => tronAddress(TRON_RECIPIENT.slice(0, -1) + (TRON_RECIPIENT.endsWith("1") ? "2" : "1")), { code: "APN_INVALID_INPUT" });
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare();
  const prepared = (await s.core.rails.records.findOperation(id))!.prepared;
  assert.throws(() => validateRailPrepared({ ...prepared, resources: { ...prepared.resources, bandwidthBytesAtomic: "1" } }, s.account), { code: "APN_STATE_CORRUPT" });
  const hex = await s.core.execute({ command: "transfer.prepare-tron", profile: s.account.profile, asset: "trx", recipient: tronHex(TRON_RECIPIENT), amount: "0.000001", maximumFee: "30", idempotencyKey: "tron-fixture-0001" });
  assert.equal(hex.ok, true); assert.equal((hex.operation as { operation_id: string }).operation_id, id);
});
