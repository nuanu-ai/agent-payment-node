import assert from "node:assert/strict";
import test from "node:test";
import { parseTransaction } from "viem";
import { bridgeExecutionDestination } from "../../src/lifi/asset-registry.js";
import { bridgeCapabilities } from "../../src/lifi/catalog.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

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

test("Linea native completion refuses absent, insufficient, or misbound destination balance evidence", async (t) => {
  for (const mutation of ["absent", "insufficient", "recipient", "block"] as const) {
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
