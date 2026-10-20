import assert from "node:assert/strict";
import test from "node:test";
import { formatEther, getAddress, type Hex } from "viem";
import { ApnError } from "../../src/errors.js";
import { prepareStargateV2NativeEth } from "../../src/stargate-v2/native-execution.js";
import { stargateNativeEnvelope } from "../../src/stargate-v2/native-runtime.js";
import { prepareStargateV2Token } from "../../src/stargate-v2/token-execution.js";
import { stargateTokenEnvelope } from "../../src/stargate-v2/token-runtime.js";
import { AMOUNT, FEE, OWNER, request, setup } from "./stargate-native-support.js";
import * as token from "./stargate-token-support.js";

// QA 0.5.57 STARGATE-NATIVE-FUNDS-AS-RPC-CONFIG-057-001: an unfunded native value reached eth_estimateGas, whose node
// error (-32003 OutOfFunds) surfaced as APN_RPC_CONFIG. A known value is now refused by name, with its numbers, first.
const POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const blocked = (reason: string, check: (details: Record<string, unknown>) => void) => (error: unknown) => {
  assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_OPERATION_BLOCKED");
  const details = error.details as Record<string, unknown>; assert.equal(details.reason, reason);
  assert.doesNotMatch(error.message, /OutOfFunds|EVM error|runtime unavailable/u); check(details); return true;
};

function counted(s: ReturnType<typeof setup>, balance?: bigint) {
  let envelopes = 0;
  const ports = { ...s.ports, prepareEnvelope: async (tx: Parameters<typeof s.ports.prepareEnvelope>[0]) => {
    envelopes++; const prepared = await s.ports.prepareEnvelope(tx);
    return balance === undefined ? prepared : { ...prepared, nativeBalanceAtomic: balance.toString() };
  } };
  return { ports, envelopes: () => envelopes };
}

test("native prepare refuses a value past the cap before any gas read, naming principal, fee and cap", async () => {
  const s = setup(), c = counted(s), cap = AMOUNT + FEE - 1n;
  await assert.rejects(prepareStargateV2NativeEth(request({ maxNativeDebitAtomic: cap.toString() }), c.ports, s.journal),
    blocked("max_native_debit_exceeded", details => assert.deepEqual(details, { reason: "max_native_debit_exceeded",
      required_wei: (AMOUNT + FEE).toString(), required_eth: formatEther(AMOUNT + FEE), max_native_debit_wei: cap.toString(),
      max_native_debit_eth: formatEther(cap), principal_wei: AMOUNT.toString(), messaging_fee_wei: FEE.toString(), gas_included: false })));
  assert.equal(c.envelopes(), 0); assert.equal(s.q.methods.includes("eth_estimateGas"), false);
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 0 });
});

test("native prepare names gas when the value fits the cap or balance but value plus gas does not", async () => {
  const gas = 100_000n * 2n;
  const s = setup(), c = counted(s);
  await assert.rejects(prepareStargateV2NativeEth(request({ maxNativeDebitAtomic: (AMOUNT + FEE).toString() }), c.ports, s.journal),
    blocked("max_native_debit_exceeded", details => { assert.equal(details.required_wei, (AMOUNT + FEE + gas).toString());
      assert.equal(details.gas_included, true); assert.equal(details.gas_upper_wei, gas.toString()); }));
  assert.equal(c.envelopes(), 1);
  const poor = setup(), p = counted(poor, AMOUNT + FEE);
  await assert.rejects(prepareStargateV2NativeEth(request(), p.ports, poor.journal),
    blocked("insufficient_native_balance", details => { assert.equal(details.native_balance_wei, (AMOUNT + FEE).toString());
      assert.equal(details.required_wei, (AMOUNT + FEE + gas).toString()); assert.equal(details.max_native_debit_wei, undefined); }));
  assert.deepEqual(poor.counts(), { sends: 0, signs: 0, approvals: 0 });
});

/** A source that answers every envelope read; `estimate` is what eth_estimateGas does. */
function source(balance: bigint, estimate: () => unknown, chainId = "0x1") {
  const methods: string[] = [];
  const answer = (method: string) => {
    methods.push(method);
    if (method === "eth_chainId") return chainId;
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: `0x${"ab".repeat(32)}`, baseFeePerGas: "0x1" };
    if (method === "eth_getBalance") return `0x${balance.toString(16)}`;
    if (method === "eth_getTransactionCount") return "0x11";
    if (method === "eth_estimateGas") return estimate();
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    throw new Error(`unexpected ${method}`);
  };
  return { methods, call: async (method: string) => answer(method),
    batchCall: async (calls: readonly { method: string }[]) => calls.map((item) => answer(item.method)) };
}

// The captured case: value 614922023256769 wei (input plus messaging fee) against a balance of 128295795269517 wei.
const VALUE = 614_922_023_256_769n, BALANCE = 128_295_795_269_517n;
const tx = { chainId: 1 as const, from: OWNER, to: POOL, data: "0x" as Hex, valueAtomic: VALUE.toString() };

for (const batch of [false, true]) test(`native envelope (${batch ? "batched" : "single"} reads) refuses an unfunded value before eth_estimateGas`, async () => {
  const rpc = source(BALANCE, () => { throw new Error("eth_estimateGas must not run"); });
  await assert.rejects(stargateNativeEnvelope(rpc as never, rpc.call, batch, tx),
    blocked("insufficient_native_balance", details => { assert.equal(details.required_wei, VALUE.toString());
      assert.equal(details.native_balance_wei, BALANCE.toString()); assert.equal(details.native_balance_eth, "0.000128295795269517");
      assert.equal(details.gas_included, false); }));
  assert.deepEqual(rpc.methods, ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance"]);
  const funded = source(VALUE, () => "0x5208");
  const prepared = await stargateNativeEnvelope(funded as never, funded.call, batch, tx);
  assert.deepEqual(prepared, { nonceAtomic: "17", gasLimitAtomic: (21_000n * 12n / 10n + 1n).toString(), maxFeePerGasAtomic: "3",
    maxPriorityFeePerGasAtomic: "1", nativeBalanceAtomic: VALUE.toString() });
  assert.equal(funded.methods.filter((method) => method === "eth_getBalance").length, 1);
});

test("a funded value whose estimate fails keeps the node failure as it was", async () => {
  const failure = new ApnError("APN_RPC_CONFIG", "Stargate native runtime unavailable: rpc_result.", { reason: "rpc_result" });
  const rpc = source(VALUE, () => { throw failure; });
  await assert.rejects(stargateNativeEnvelope(rpc as never, rpc.call, false, tx), (error) => error === failure);
});

test("token envelope refuses a messaging fee the Optimism balance cannot pay before eth_estimateGas", async () => {
  const rpc = source(FEE - 1n, () => { throw new Error("eth_estimateGas must not run"); }, "0xa");
  await assert.rejects(stargateTokenEnvelope(rpc, { chainId: 10, from: OWNER, to: POOL, data: "0x", valueAtomic: FEE.toString() }),
    blocked("insufficient_native_balance", details => assert.equal(details.native_balance_wei, (FEE - 1n).toString())));
  assert.equal(rpc.methods.includes("eth_estimateGas"), false);
});

test("token prepare refuses a messaging fee at or past the cap before any envelope read", async () => {
  const s = token.setup();
  await assert.rejects(prepareStargateV2Token(token.request({ maxNativeDebitAtomic: token.FEE.toString() }), s.ports, s.journal),
    blocked("max_native_debit_exceeded", details => { assert.equal(details.messaging_fee_wei, token.FEE.toString());
      assert.equal(details.gas_included, false); }));
  assert.deepEqual(s.simulations(), { preparedApprovals: 0, preparedBridges: 0, bridgeEstimates: 0, bridgeCalls: 0 });
  assert.equal(s.counts().sends, 0);
});
