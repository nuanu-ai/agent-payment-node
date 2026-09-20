import assert from "node:assert/strict";
import test from "node:test";
import { parseTransaction } from "viem";
import { bridgeExecutionDestination } from "../../src/lifi/asset-registry.js";
import { bridgeCapabilities } from "../../src/lifi/catalog.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { BridgeAllowlistGate, LIFI_ACROSS_BRIDGE_MECHANISM } from "../../src/lifi/allowlist.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { LIFI_SYNTHETIC_SENDER } from "./lifi-helpers.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeFunctionData } from "viem";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";

test("immutable anonymous Linea capture binds the exact real quote and materialization", async () => {
  const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/lifi-ethereum-linea-native-across-20260920.json"), "utf8")) as any;
  assert.equal(capture.capture.mode, "anonymous_read_only_no_signing_no_send");
  assert.equal(sha256(JSON.stringify(capture.routeResponse)), capture.capture.routeResponseSha256);
  assert.equal(sha256(JSON.stringify(capture.stepResponse)), capture.capture.stepResponseSha256);
  const step = capture.stepResponse;
  assert.equal(step.tool, "across"); assert.equal(step.action.fromAddress, step.action.toAddress);
  assert.equal(step.action.fromAmount, "200000000000000"); assert.equal(step.estimate.toAmount, "189197517787962");
  assert.equal(BigInt(step.transactionRequest.value).toString(), "200000000000000");
  assert.equal(BigInt(step.transactionRequest.gasLimit).toString(), "533000");
  const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data }) as any;
  assert.equal(decoded.args[0].minAmount.toString(), "199500000000000"); assert.equal(decoded.args[2].message, "0x");
});

test("immutable Linea RPC baseline verifies the exact safe-block SpokePool, WETH and buffers", async () => {
  const raw = await readFile(resolve("tests/core/lifi-fixtures/deployment-linea-rpc-20260920.json"), "utf8");
  assert.equal(sha256(raw), "6c98ae74d2f011a07551157d5038fcd0c59fb4e8e97add08fe9bb95fc2a85d45");
  const capture = JSON.parse(raw) as any;
  assert.equal(capture.mode, "public_read_only_no_signing_no_send");
  assert.deepEqual(capture.safeBlock, { number: "0x1e9a3ec",
    hash: "0x313150b011d0f89dba2545a04c6f397482db04fdb82bca46ef8118d85f4dcae0", timestamp: "0x6aaf91b6" });
  const values = new Map(capture.requests.map((row: any) => [canonicalJson([row.request.method, row.request.params]), row.response.result]));
  const call: EvmRpcCall = async (method, params) => {
    const key = canonicalJson([method, params]); assert.equal(values.has(key), true, key); return structuredClone(values.get(key));
  };
  const block = { numberAtomic: BigInt(capture.safeBlock.number).toString(), hash: capture.safeBlock.hash,
    timestampAtomic: BigInt(capture.safeBlock.timestamp).toString() };
  const proof = await new BridgeRpc(59144, capture.rpcOrigin, call).deployment("across", 1, BRIDGE_ZERO_ADDRESS, block);
  assert.equal(proof.block.hash, capture.safeBlock.hash); assert.equal(proof.chainId, 59144); assert.equal(proof.peerChainId, 1);
  const unavailable: EvmRpcCall = async (method, params) => {
    if (method === "debug_traceTransaction") throw new Error("method unavailable");
    return await call(method, params);
  };
  await assert.rejects(new BridgeRpc(59144, capture.rpcOrigin, unavailable).deployment("across", 1, BRIDGE_ZERO_ADDRESS, block));
});

test("Linea native Across executes one exact EIP-1559 source effect and completes only with safe native delta proof", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-linea");
  s.provider.statusValue = "completed_observed";
  const { id, operation } = await s.prepare("across", "lifi-linea-native-001");
  assert.equal(operation.intent.materialization.request.toChainId, 59144);
  assert.equal(operation.intent.materialization.request.fromToken, BRIDGE_ZERO_ADDRESS);
  assert.equal(operation.intent.materialization.request.toToken, BRIDGE_ZERO_ADDRESS);
  assert.deepEqual(operation.effects.map((effect) => effect.role), ["bridge"]);
  assert.equal(operation.effects[0]!.envelope.chainId, 1);
  assert.equal(operation.effects[0]!.envelope.to, BRIDGE_DIAMOND);
  assert.equal(operation.effects[0]!.envelope.valueAtomic, operation.intent.materialization.request.amountAtomic);

  const completed = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(completed.ok, true, completed.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(record.state, "completed", JSON.stringify({ failure: record.failure, provider: record.providerObservation }));
  assert.equal(record.destinationProof?.chainId, 59144);
  assert.equal(record.destinationProof?.token, BRIDGE_ZERO_ADDRESS);
  assert.equal(record.destinationProof?.nativeBalance?.recipient, record.intent.materialization.request.recipient);
  assert.equal(record.destinationProof?.nativeBalance?.deltaAtomic, record.destinationProof?.amountAtomic);
  assert.deepEqual(record.destinationProof?.nativeTransfer, {
    transactionHash: record.destinationProof?.transactionHash, from: record.intent.destinationDeployment.tool === "across"
      ? record.destinationProof?.nativeTransfer?.from : "", to: record.intent.owner.address,
    valueAtomic: record.destinationProof?.amountAtomic, traceHash: "a".repeat(64),
  });
  assert.deepEqual(record.intent.allowlist!.mechanism, LIFI_ACROSS_BRIDGE_MECHANISM);
  assert.equal((completed.operation as any).policy.allowlist.self_recipient, record.intent.owner.address);
  assert.equal((completed.operation as any).policy.allowlist.reservation_id, record.usageLease?.reservationId);
  assert.equal(s.source.submissions.length, 1);
  const signed = parseTransaction(s.source.submissions[0]!);
  assert.equal(signed.type, "eip1559"); assert.equal(signed.chainId, 1);
  assert.equal(signed.to!.toLowerCase(), BRIDGE_DIAMOND.toLowerCase()); assert.equal(signed.value?.toString(), record.intent.materialization.request.amountAtomic);
  assert.equal(signed.data, record.effects[0]!.envelope.data);

  const sourceCalls = s.source.calls.length, destinationCalls = s.destination.calls.length, providerCalls = s.provider.statusCalls;
  for (let i = 0; i < 2; i++) {
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(resumed.ok, true, resumed.error?.message);
    const status = await s.core.execute({ command: "operation.status", operationId: id });
    assert.equal(status.ok, true, status.error?.message);
  }
  assert.equal(s.source.submissions.length, 1);
  assert.equal(s.source.calls.length, sourceCalls); assert.equal(s.destination.calls.length, destinationCalls);
  assert.equal(s.provider.statusCalls, providerCalls);
});

test("Linea preparation requires the exact self recipient and exact LI.FI/Across owner pin", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const missing = await lifiFixture(temporary.root, "eth-linea", { policy: false });
  const absent = await missing.core.execute({ command: "bridge.routes", profile: missing.profile, request: missing.request });
  assert.equal(absent.ok, true);
  const refused = await missing.core.execute({ command: "bridge.prepare", profile: missing.profile,
    quote: (absent.data as any).quote_hash, route: (absent.data as any).routes[0].route_id, idempotencyKey: "linea-no-policy-001" });
  assert.equal(refused.ok, false); assert.equal(refused.error?.details?.reason, "allowlist_policy_required");

  for (const policy of [{ provider: "other" }, { reference: "across-v3" }]) {
    const other = await temporaryState(); t.after(other.cleanup);
    const s = await lifiFixture(other.root, "eth-linea", { policy });
    const routes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
    const result = await s.core.execute({ command: "bridge.prepare", profile: s.profile, quote: (routes.data as any).quote_hash,
      route: (routes.data as any).routes[0].route_id, idempotencyKey: `linea-pin-${policy.provider ?? policy.reference}` });
    assert.equal(result.ok, false); assert.equal(result.error?.details?.reason, "bridge_mechanism_mismatch");
  }

  const self = await temporaryState(); t.after(self.cleanup);
  const s = await lifiFixture(self.root, "eth-linea");
  const gate = new BridgeAllowlistGate({ state: s.state, clock: { now: () => new Date(s.now) } });
  await assert.rejects(gate.admit(s.profile, LIFI_SYNTHETIC_SENDER, { ...s.request,
    recipient: "0x1111111111111111111111111111111111111111" }, "across"),
  (error: any) => error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "bridge_self_recipient_required");
});

test("Linea shared usage reservation is atomic, survives unknown outcome, and blocks daily-cap bypass", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const amount = "200000000000000", s = await lifiFixture(temporary.root, "eth-linea", {
    policy: { maximumPerTransferAtomic: amount, dailyLimitAtomic: amount },
  });
  const routes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  const base = { command: "bridge.prepare" as const, profile: s.profile, quote: (routes.data as any).quote_hash,
    route: (routes.data as any).routes[0].route_id };
  const concurrent = await Promise.all([
    s.core.execute({ ...base, idempotencyKey: "linea-cap-first-001" }),
    s.core.execute({ ...base, idempotencyKey: "linea-cap-second-001" }),
  ]);
  assert.equal(concurrent.filter((row) => row.ok).length, 1);
  assert.equal(concurrent.filter((row) => !row.ok && row.error?.code === "APN_OPERATION_BLOCKED").length, 1);

  const unknownRoot = await temporaryState(); t.after(unknownRoot.cleanup);
  const u = await lifiFixture(unknownRoot.root, "eth-linea", { policy: { maximumPerTransferAtomic: amount, dailyLimitAtomic: amount } });
  u.source.sendTimeout = true; u.source.failObserve = true;
  const prepared = await u.prepare("across", "linea-unknown-001");
  const sent = await u.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal(sent.ok, true); const record = (await u.core.bridges.records.findOperation(prepared.id))!;
  assert.equal(record.state, "unknown_finality");
  const lease = await new AssetUsageLedger(unknownRoot.root).load({ account: record.intent.owner.address,
    chain: record.intent.allowlist!.chain, asset: record.intent.allowlist!.asset }, record.usageLease!.reservationId);
  assert.equal(lease?.state, "unknown_finality");
  await assert.rejects(new BridgeAllowlistGate({ state: u.state, clock: { now: () => new Date(u.now) } })
    .admit(u.profile, record.intent.owner.address, u.request, "across"),
  (error: any) => error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_daily_cap_exceeded");
  const nextRoutes = await u.core.execute({ command: "bridge.routes", profile: u.profile, request: u.request });
  const capped = await u.core.execute({ command: "bridge.prepare", profile: u.profile, quote: (nextRoutes.data as any).quote_hash,
    route: (nextRoutes.data as any).routes[0].route_id, idempotencyKey: "linea-unknown-second-001" });
  assert.equal(capped.ok, false); assert.equal(capped.error?.code, "APN_OPERATION_BLOCKED");
});

test("Linea reconciles an exact reservation after a crash before the operation save", async (t) => {
  const amount = "200000000000000";
  for (const outcome of ["rejected", "expired", "policy-drift", "completed"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-linea", {
      policy: { maximumPerTransferAtomic: amount, dailyLimitAtomic: amount },
    });
    if (outcome === "completed") s.provider.statusValue = "completed_observed";
    const prepared = await s.prepare("across", `linea-crash-${outcome}`), binding = prepared.operation.intent.allowlist!;
    const identity = { account: binding.account, chain: binding.chain, asset: binding.asset };
    const reservationId = assetUsageReservationId(identity, `apn.bridge-usage:${prepared.id}`);
    const repository = s.core.bridges.records as any, persist = repository.persist.bind(repository);
    let injected = false;
    repository.persist = async (op: any) => {
      if (!injected && op.state === "execution_pending" && op.usageLease !== null) {
        injected = true; throw new Error("fault_after_usage_reserve_before_operation_save");
      }
      return await persist(op);
    };
    const crashed = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(crashed.ok, false); assert.equal(injected, true);
    const unchanged = (await s.core.bridges.records.findOperation(prepared.id))!;
    assert.equal(unchanged.state, "awaiting_approval"); assert.equal(unchanged.usageLease, null);
    const ledger = new AssetUsageLedger(temporary.root), orphan = await ledger.load(identity, reservationId);
    assert.equal(orphan?.state, "reserved");
    assert.equal((await ledger.usage(identity, s.now)).amountAtomic, amount);
    repository.persist = persist;

    if (outcome === "rejected") s.approval.accepted = false;
    if (outcome === "expired") s.now.setTime(Date.parse(unchanged.intent.expiresAt) + 1);
    if (outcome === "policy-drift") await activateDirectPolicy(temporary.root, s.profile, {
      accounts: { evm: LIFI_SYNTHETIC_SENDER }, now: new Date(s.now.getTime() + 1), admissions: [{
        chain: "eip155:1", kind: "native", rail: "bridge", maximumPerTransferAtomic: (BigInt(amount) * 2n).toString(),
        dailyLimitAtomic: (BigInt(amount) * 2n).toString(), mechanism: LIFI_ACROSS_BRIDGE_MECHANISM,
      }],
    });
    const retried = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(retried.ok, true, retried.error?.message);
    const record = (await s.core.bridges.records.findOperation(prepared.id))!;
    const recovered = await ledger.load(identity, reservationId);
    if (outcome === "completed") {
      assert.equal(record.state, "completed"); assert.equal(record.usageLease?.reservationId, reservationId);
      assert.equal(recovered?.state, "finalized");
      assert.equal((await ledger.usage(identity, s.now)).amountAtomic, amount);
      assert.equal(s.source.submissions.length, 1);
    } else {
      assert.equal(record.state, "failed_before_effect"); assert.equal(record.usageLease, null);
      assert.equal(recovered?.state, "failed_before_effect");
      assert.equal((await ledger.usage(identity, s.now)).amountAtomic, "0");
      assert.equal(s.source.submissions.length, 0);
    }
  }
});

test("Linea execution refuses active policy drift before signing or sending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-linea"), prepared = await s.prepare("across", "linea-policy-drift-001");
  await activateDirectPolicy(temporary.root, s.profile, { accounts: { evm: LIFI_SYNTHETIC_SENDER }, now: s.now, admissions: [{
    chain: "eip155:1", kind: "native", rail: "bridge", maximumPerTransferAtomic: "200000000000000",
    dailyLimitAtomic: "400000000000000", mechanism: LIFI_ACROSS_BRIDGE_MECHANISM,
  }] });
  const result = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal(result.ok, true); const record = (await s.core.bridges.records.findOperation(prepared.id))!;
  assert.equal(record.state, "failed_before_effect"); assert.equal(record.failure?.reason, "unsent_apn_allowlist_refused");
  assert.equal(s.source.submissions.length, 0); assert.equal(record.usageLease, null);
});

test("Linea native completion refuses missing or misbound trace delivery and corroborating balance evidence", async (t) => {
  for (const mutation of ["absent", "insufficient", "recipient", "block", "unrelated-credit", "unrelated-debit", "trace-from", "trace-recipient", "trace-value", "trace-hash"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-linea");
    s.provider.statusValue = "completed_observed";
    const original = s.destination.observe.bind(s.destination);
    s.destination.observe = async (...args) => {
      const observed = await original(...args);
      if (observed === null || args[1] !== undefined) return observed;
      const receipt: any = structuredClone(observed.receipt);
      if (mutation === "absent") delete receipt.nativeBalance;
      if (mutation === "insufficient") { receipt.nativeBalance.afterBalanceAtomic = receipt.nativeBalance.beforeBalanceAtomic; receipt.nativeBalance.deltaAtomic = "0"; }
      if (mutation === "recipient") receipt.nativeBalance.recipient = "0x1111111111111111111111111111111111111111";
      if (mutation === "block") receipt.nativeBalance.afterBlock.hash = `0x${"ff".repeat(32)}`;
      if (mutation === "unrelated-credit") { receipt.nativeBalance.afterBalanceAtomic = (BigInt(receipt.nativeBalance.afterBalanceAtomic) + 1n).toString(); receipt.nativeBalance.deltaAtomic = (BigInt(receipt.nativeBalance.deltaAtomic) + 1n).toString(); delete receipt.nativeTransfer; }
      if (mutation === "unrelated-debit") { receipt.nativeBalance.beforeBalanceAtomic = (BigInt(receipt.nativeBalance.beforeBalanceAtomic) - 1n).toString(); receipt.nativeBalance.deltaAtomic = (BigInt(receipt.nativeBalance.deltaAtomic) + 1n).toString(); delete receipt.nativeTransfer; }
      if (mutation === "trace-from") receipt.nativeTransfer.from = "0x1111111111111111111111111111111111111111";
      if (mutation === "trace-recipient") receipt.nativeTransfer.to = "0x1111111111111111111111111111111111111111";
      if (mutation === "trace-value") receipt.nativeTransfer.valueAtomic = (BigInt(receipt.nativeTransfer.valueAtomic) - 1n).toString();
      if (mutation === "trace-hash") receipt.nativeTransfer.traceHash = "z".repeat(64);
      return { ...observed, receipt };
    };
    const { id } = await s.prepare("across", `lifi-linea-proof-${mutation}`);
    const result = await s.core.execute({ command: "bridge.approve", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const record = (await s.core.bridges.records.findOperation(id))!;
    assert.equal(record.state, "unknown_finality", mutation);
    assert.equal(record.destinationProof, null); assert.equal(s.source.submissions.length, 1);
    await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(s.source.submissions.length, 1);
  }
});

test("BNB native stays LI.FI-local quote-only and cannot enter the execution destination set", () => {
  assert.equal(bridgeExecutionDestination(56), false);
  assert.equal(bridgeExecutionDestination(59144), true);
  assert.throws(() => bridgeDeployment(1, 56, "across", BRIDGE_ZERO_ADDRESS), /bnb_composite_execution_unreviewed/u);
  assert.throws(() => bridgeDeployment(56, 1, "across", BRIDGE_ZERO_ADDRESS), /bnb_composite_execution_unreviewed/u);
  const capabilities = bridgeCapabilities();
  const bnb = capabilities.chains.find((row) => row.chain === "eip155:56")!;
  const linea = capabilities.chains.find((row) => row.chain === "eip155:59144")!;
  assert.deepEqual({ bridgeable: bnb.native_coin.bridgeable_principal, quoteOnly: bnb.native_coin.quote_only },
    { bridgeable: false, quoteOnly: true });
  assert.deepEqual({ bridgeable: linea.native_coin.bridgeable_principal, quoteOnly: linea.native_coin.quote_only },
    { bridgeable: true, quoteOnly: false });
  assert.ok(capabilities.inventory_only.some((row) => "asset" in row && row.asset === "native_BNB_eip155:56"));
});
