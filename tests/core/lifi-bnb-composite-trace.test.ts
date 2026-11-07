import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, encodeFunctionData, getAddress, parseAbi, parseAbiParameters } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage, verifyFlyHeaderSignature } from "../../src/lifi/bnb-composite.js";
import { verifyBnbCompositeTrace } from "../../src/lifi/bnb-composite-trace.js";
import { lifiCapture } from "./lifi-capture.js";

// The 2026-11-05 capture: Fly routes WETH -> BTCB -> WBNB -> BNB, and Across fills more WETH than the Fly input.
const fixture = lifiCapture("bnb-composite-fly-20261105.json").decoded as {
  bridgeData: { transactionId: Hex; receiver: Address }; acrossData: { message: Hex; outputAmount: string };
};
const MESSAGE = fixture.acrossData.message, FILLED = BigInt(fixture.acrossData.outputAmount);
const call = decodeBnbCompositeMessage(MESSAGE, fixture.bridgeData.transactionId, fixture.bridgeData.receiver);
const INPUT = BigInt(call.inputAmountAtomic), EXPECTED = BigInt(call.expectedOutputAtomic);
const RELAYER = "0x2222222222222222222222222222222222222222" as Address, CALLDATA = "0xdeff4b24deadbeef" as Hex;
const SPOKE_IMPL = "0x5555555555555555555555555555555555555555" as Address, WETH_IMPL = "0x6666666666666666666666666666666666666666" as Address;
const BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" as Address, POOL_A = "0x7777777777777777777777777777777777777777" as Address;
const POOL_B = "0x8888888888888888888888888888888888888888" as Address, CORE_MODULE = "0x9999999999999999999999999999999999999999" as Address;
const MAX = (1n << 256n) - 1n, TRUE = `0x${"0".repeat(63)}1` as Hex;
const abi = parseAbi([
  "function handleV3AcrossMessage(address,uint256,address,bytes)",
  "function swapAndCompleteBridgeTokens(bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address,address)",
  "function approve(address,uint256)", "function transfer(address,uint256)", "function transferFrom(address,address,uint256)",
  "function balanceOf(address)", "function allowance(address,address)", "function withdraw(uint256)", "function swap(address,bool,int256,uint160,bytes)",
]);
type Frame = { type: string; from: Address; to: Address; value: string; input: Hex; output: Hex; calls: Frame[]; error?: string };

function frame(from: Address, to: Address, input: Hex, value = 0n, calls: Frame[] = [], output: Hex = "0x", type = "CALL"): Frame {
  return { type, from, to, value: `0x${value.toString(16)}`, input, output, calls };
}
/** A Binance-peg token call: the proxy delegates to its implementation, which makes no further calls. */
function token(from: Address, address: Address, name: "approve" | "transfer" | "transferFrom", args: readonly unknown[]): Frame {
  const input = encodeFunctionData({ abi, functionName: name, args: args as never });
  return frame(from, address, input, 0n, [frame(address, WETH_IMPL, input, 0n, [], TRUE, "DELEGATECALL")], TRUE);
}
function read(from: Address, address: Address, name: "balanceOf" | "allowance", args: readonly unknown[]): Frame {
  const input = encodeFunctionData({ abi, functionName: name, args: args as never }), output = `0x${"0".repeat(63)}5` as Hex;
  return frame(from, address, input, 0n, [frame(address, WETH_IMPL, input, 0n, [], output, "DELEGATECALL")], output, "STATICCALL");
}
function coreInput(): Hex {
  const raw = Buffer.from(call.flyCalldata.slice(2), "hex"), length = Number(BigInt(`0x${raw.subarray(36, 68).toString("hex")}`));
  return `0x158f6894${raw.subarray(4, 68 + length).toString("hex")}`;
}

/** Fly Core's multi-hop route: opaque to APN apart from the native value it settles with the router (and Executor). */
function coreRoute(gross: bigint, direct = 0n): Frame {
  const C = BNB_COMPOSITE.core, swapA = encodeFunctionData({ abi, functionName: "swap", args: [C, true, INPUT, 0n, "0x"] });
  return frame(BNB_COMPOSITE.flyRouter, C, coreInput(), 0n, [
    read(C, BNB_COMPOSITE.weth, "balanceOf", [C]),
    frame(C, CORE_MODULE, "0x1234", 0n, [
      frame(C, POOL_A, swapA, 0n, [
        token(POOL_A, BTCB, "transfer", [C, 1000n]),
        frame(POOL_A, C, "0xfa461e33", 0n, [token(C, BNB_COMPOSITE.weth, "transfer", [POOL_A, INPUT])]),
      ]),
    ], "0x", "DELEGATECALL"),
    { ...frame(C, POOL_B, "0xabcdef01", 0n, [frame(POOL_B, BNB_COMPOSITE.flyRouter, "0x", 5n)]), error: "execution reverted" },
    frame(C, POOL_B, "0x128acb08", 0n, [token(POOL_B, BNB_COMPOSITE.wbnb, "transfer", [C, gross + direct]),
      frame(POOL_B, C, "0x23a69e75", 0n, [token(C, BTCB, "transfer", [POOL_B, 1000n])])]),
    frame(C, BNB_COMPOSITE.wbnb, encodeFunctionData({ abi, functionName: "withdraw", args: [gross + direct] }), 0n,
      [frame(BNB_COMPOSITE.wbnb, C, "0x", gross + direct)]),
    frame(C, BNB_COMPOSITE.flyRouter, "0x", gross),
    ...(direct > 0n ? [frame(C, BNB_COMPOSITE.executor, "0x", direct)] : []),
  ], `0x${"0".repeat(128)}`);
}

interface Shape { gross?: bigint; direct?: bigint; approve?: boolean; filled?: bigint; retention?: bigint }
/** The fill as a real BSC trace shows it: proxied SpokePool and WETH, balance and allowance reads, Executor approvals. */
function fillTrace(shape: Shape = {}): Frame {
  const gross = shape.gross ?? EXPECTED + EXPECTED / 1000n, direct = shape.direct ?? 0n, filled = shape.filled ?? FILLED;
  const retention = shape.retention ?? BigInt(call.maximumRetentionBps);
  const paid = gross <= EXPECTED ? gross : [EXPECTED, gross - gross * retention / 10_000n].reduce((a, b) => a > b ? a : b);
  const [, swaps] = decodeAbiParameters(parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address"), MESSAGE);
  const E = BNB_COMPOSITE.executor, R = BNB_COMPOSITE.receiver, W = BNB_COMPOSITE.weth, F = BNB_COMPOSITE.flyRouter;
  const fly = frame(E, F, call.flyCalldata, 0n, [
    token(F, W, "transferFrom", [E, BNB_COMPOSITE.core, INPUT]), coreRoute(gross, direct), frame(F, E, "0x", paid),
  ], `0x${"0".repeat(64)}`);
  const executor = frame(R, E, encodeFunctionData({ abi, functionName: "swapAndCompleteBridgeTokens",
    args: [call.transactionId, swaps, W, call.finalReceiver] }), 0n, [
    read(E, W, "balanceOf", [E]), read(E, W, "allowance", [R, E]), read(E, W, "balanceOf", [R]), read(E, W, "balanceOf", [E]),
    token(E, W, "transferFrom", [R, E, filled]), read(E, W, "balanceOf", [E]), read(E, W, "balanceOf", [E]),
    read(E, W, "allowance", [E, F]),
    ...(shape.approve === false ? [] : [token(E, W, "approve", [F, 0n]), read(E, W, "allowance", [E, F]), token(E, W, "approve", [F, MAX])]),
    fly, read(E, W, "balanceOf", [E]),
    ...(filled > INPUT ? [read(E, W, "balanceOf", [E]), token(E, W, "transfer", [call.finalReceiver, filled - INPUT])] : []),
    frame(E, call.finalReceiver, "0x", paid + direct),
  ]);
  const handler = frame(BNB_COMPOSITE.spokePool, R, encodeFunctionData({ abi, functionName: "handleV3AcrossMessage",
    args: [W, filled, RELAYER, MESSAGE] }), 0n, [token(R, W, "approve", [E, filled]), executor, token(R, W, "approve", [E, 0n])]);
  return frame(RELAYER, BNB_COMPOSITE.spokePool, CALLDATA, 0n, [frame(BNB_COMPOSITE.spokePool, SPOKE_IMPL, CALLDATA, 0n, [
    token(BNB_COMPOSITE.spokePool, W, "transferFrom", [RELAYER, R, filled]), handler,
  ], "0x", "DELEGATECALL")]);
}
function verify(trace: unknown, filled = FILLED, signed = call) {
  return verifyBnbCompositeTrace(trace, `0x${"12".repeat(32)}`, MESSAGE, signed, { sender: RELAYER, target: BNB_COMPOSITE.spokePool,
    calldata: CALLDATA, amountAtomic: filled.toString() });
}
const at = (root: any, path: readonly (string | number)[]): any => path.reduce((value, key) => value[key], root);
const HANDLER = ["calls", 0, "calls", 1] as const, EXECUTOR = [...HANDLER, "calls", 1] as const;
const FLY = [...EXECUTOR, "calls", 11] as const, CORE = [...FLY, "calls", 1] as const;

test("a realistic proxied fill with a multi-hop Fly route proves native delivery and the returned WETH", () => {
  const proof = verify(fillTrace()), gross = EXPECTED + EXPECTED / 1000n;
  assert.deepEqual({ outcome: proof.outcome, gross: proof.vaultOutputAtomic, delivered: proof.deliveredAmountAtomic,
    retained: proof.retainedAmountAtomic, returned: proof.returnedWethAtomic, hash: proof.traceHash.length },
  { outcome: "completed_native", gross: gross.toString(), delivered: EXPECTED.toString(), retained: (gross - EXPECTED).toString(),
    returned: (FILLED - INPUT).toString(), hash: 64 });
  assert.equal(verify(fillTrace({ approve: false })).outcome, "completed_native");
  assert.equal(verify(fillTrace({ filled: INPUT }), INPUT).returnedWethAtomic, "0");
  const direct = verify(fillTrace({ direct: 7n }));
  assert.deepEqual([direct.outcome, direct.deliveredAmountAtomic], ["completed_native", (EXPECTED + 7n).toString()]);
  // Below the expected output the router pays all of it, so delivery under the signed floor is reported as such.
  const low = verify(fillTrace({ gross: BigInt(call.minimumOutputAtomic) - 1n }));
  assert.deepEqual([low.outcome, low.retainedAmountAtomic], ["below_floor", "0"]);
});

test("Fly Core's route is opaque: frames that move no native value may change without changing the proof", () => {
  const base = verify(fillTrace());
  for (const mutate of [
    (t: any) => { at(t, [...CORE, "calls", 1, "calls", 0]).input = "0xdeadbeef"; },
    (t: any) => { at(t, [...CORE, "calls", 3]).input = "0x00"; },
    (t: any) => { at(t, CORE).calls.splice(0, 1); },
    (t: any) => { at(t, [...CORE, "calls", 2]).calls = []; },
  ]) {
    const trace = fillTrace(); mutate(trace); const proof = verify(trace);
    assert.equal(proof.outcome, "completed_native"); assert.equal(proof.deliveredAmountAtomic, base.deliveredAmountAtomic);
    assert.notEqual(proof.traceHash, base.traceHash);
  }
  // Native settlement is what is read. Value under a reverted frame does not count; once it does, the router keeps it
  // within the signed retention, so only the gross and retained amounts move.
  const unreverted = fillTrace(); at(unreverted, [...CORE, "calls", 2]).error = undefined;
  const kept = verify(unreverted);
  assert.deepEqual([kept.outcome, BigInt(kept.vaultOutputAtomic!) - BigInt(base.vaultOutputAtomic!), BigInt(kept.retainedAmountAtomic) - BigInt(base.retainedAmountAtomic)],
    ["completed_native", 5n, 5n]);
  // A changed, reverted, extra or redirected payment that the router's rule cannot produce is a mismatch.
  for (const mutate of [
    (t: any) => { at(t, [...CORE, "calls", 5]).value = "0x1"; },
    (t: any) => { at(t, [...CORE, "calls", 5]).error = "execution reverted"; },
    (t: any) => { at(t, CORE).calls.push(frame(BNB_COMPOSITE.core, BNB_COMPOSITE.executor, "0x", 1n)); },
    (t: any) => { at(t, [...CORE, "calls", 5]).to = BNB_COMPOSITE.executor; },
  ]) {
    const trace = fillTrace(); mutate(trace);
    assert.equal(verify(trace).outcome, "protocol_mismatch");
  }
});

test("every effect outside Fly Core is exact", () => {
  const trace = fillTrace(), outside: (string | number)[][] = [];
  const visit = (node: Frame, path: (string | number)[]) => {
    if (path.join(".") === CORE.join(".")) return;
    if (node.type === "CALL" && path.length > 0) outside.push(path);
    node.calls.forEach((child, index) => { if (child.type !== "STATICCALL") visit(child, [...path, "calls", index]); });
  };
  visit(trace, []);
  assert.equal(outside.length, 13);
  const tolerated = new Set([["calls", 0, "calls", 0].join(".")]);
  for (const path of outside) {
    for (const [key, replacement] of [["input", "0xdeadbeef"], ["value", "0x1"], ["to", "0x3333333333333333333333333333333333333333"]] as const) {
      const changed = fillTrace(); at(changed, path)[key] = replacement;
      // The relayer's WETH movement into the Receiver is the SpokePool's business, proven by FilledRelay instead.
      if (tolerated.has(path.join("."))) continue;
      assert.equal(verify(changed).outcome, "protocol_mismatch", `${key}:${path.join(".")}`);
    }
  }
  for (const path of [...outside.filter((path) => !tolerated.has(path.join("."))), CORE]) {
    const failed = fillTrace(); at(failed, path).error = "execution reverted";
    if (path.join(".") === EXECUTOR.join(".")) continue;
    assert.equal(verify(failed).outcome, "protocol_mismatch", `error:${path.join(".")}`);
  }
  const extra = fillTrace(); at(extra, EXECUTOR).calls.splice(12, 0, token(BNB_COMPOSITE.executor, BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.flyRouter, 0n]));
  assert.equal(verify(extra).outcome, "protocol_mismatch");
  const reordered = fillTrace(); at(reordered, FLY).calls.reverse();
  assert.equal(verify(reordered).outcome, "protocol_mismatch");
  const noReturn = fillTrace(); at(noReturn, EXECUTOR).calls.splice(13, 2);
  assert.equal(verify(noReturn).outcome, "protocol_mismatch");
});

test("the trace is bound to its transaction, the fill amount, one handler and consistent callers", () => {
  assert.equal(verifyBnbCompositeTrace(fillTrace(), `0x${"12".repeat(32)}`, MESSAGE, call,
    { sender: "0x3333333333333333333333333333333333333333", target: BNB_COMPOSITE.spokePool, calldata: CALLDATA, amountAtomic: FILLED.toString() }).outcome, "protocol_mismatch");
  assert.equal(verifyBnbCompositeTrace(fillTrace(), `0x${"12".repeat(32)}`, MESSAGE, call,
    { sender: RELAYER, target: BNB_COMPOSITE.spokePool, calldata: "0xdeadbeef", amountAtomic: FILLED.toString() }).outcome, "protocol_mismatch");
  // The root's target is the verified transaction's too: a trace of the same calldata sent elsewhere is not this fill.
  assert.equal(verifyBnbCompositeTrace(fillTrace(), `0x${"12".repeat(32)}`, MESSAGE, call,
    { sender: RELAYER, target: "0x3333333333333333333333333333333333333333", calldata: CALLDATA, amountAtomic: FILLED.toString() }).outcome, "protocol_mismatch");
  const retargeted = fillTrace(); retargeted.to = "0x3333333333333333333333333333333333333333";
  assert.equal(verify(retargeted).outcome, "protocol_mismatch");
  // Address case in the bound transaction or in the RPC answer does not matter.
  const recased = fillTrace(); recased.to = recased.to.toLowerCase() as Address; recased.from = recased.from.toLowerCase() as Address;
  assert.equal(verifyBnbCompositeTrace(recased, `0x${"12".repeat(32)}`, MESSAGE, call, { sender: RELAYER.toLowerCase() as Address,
    target: BNB_COMPOSITE.spokePool.toLowerCase() as Address, calldata: CALLDATA, amountAtomic: FILLED.toString() }).outcome, "completed_native");
  assert.equal(verify(fillTrace(), FILLED + 1n).outcome, "protocol_mismatch");
  assert.equal(verify(fillTrace({ filled: INPUT - 1n }), INPUT - 1n).outcome, "protocol_mismatch");
  // A batched fill of another deposit beside ours does not matter; a second handler of our message does.
  const batched = fillTrace(), other = structuredClone(at(batched, HANDLER));
  other.input = encodeFunctionData({ abi, functionName: "handleV3AcrossMessage", args: [BNB_COMPOSITE.weth, 1n, RELAYER, "0x1234"] });
  at(batched, ["calls", 0]).calls.push(other);
  assert.equal(verify(batched).outcome, "completed_native");
  const twice = fillTrace(); at(twice, ["calls", 0]).calls.push(structuredClone(at(twice, HANDLER)));
  assert.equal(verify(twice).outcome, "protocol_mismatch");
  const reverted = fillTrace(); at(reverted, ["calls", 0]).error = "execution reverted";
  assert.equal(verify(reverted).outcome, "protocol_mismatch");
  for (const path of [HANDLER, EXECUTOR, FLY, CORE, [...CORE, "calls", 1, "calls", 0]]) {
    const changed = fillTrace(); at(changed, path).from = "0x3333333333333333333333333333333333333333";
    assert.equal(verify(changed).outcome, "protocol_mismatch", `from:${path.join(".")}`);
  }
});

test("at 10000 basis points a swap that beats expected pays exactly the expected output", () => {
  const all = { ...call, maximumRetentionBps: 10_000 }, gross = EXPECTED * 2n;
  const proof = verify(fillTrace({ gross, retention: 10_000n }), FILLED, all);
  assert.deepEqual([proof.outcome, proof.deliveredAmountAtomic, proof.retainedAmountAtomic],
    ["completed_native", EXPECTED.toString(), (gross - EXPECTED).toString()]);
  // The same swap paid under a 500 bps rule hands the Executor more than a 10000 bps header allows: that is not this quote.
  assert.equal(verify(fillTrace({ gross, retention: 500n }), FILLED, all).outcome, "protocol_mismatch");
});

test("a reverted swap proves the whole fill came back as WETH", () => {
  const trace = fillTrace(), handler = at(trace, HANDLER), executor = handler.calls[1];
  executor.error = "execution reverted"; executor.output = "0x";
  handler.calls = [handler.calls[0], executor, token(BNB_COMPOSITE.receiver, BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, FILLED]), handler.calls[2]];
  const proof = verify(trace);
  assert.deepEqual([proof.outcome, proof.deliveredAmountAtomic, proof.returnedWethAtomic], ["recovered_weth", "0", FILLED.toString()]);
  const short = structuredClone(trace); at(short, HANDLER).calls[2] = token(BNB_COMPOSITE.receiver, BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, INPUT]);
  assert.equal(verify(short).outcome, "protocol_mismatch");
});

test("a real BSC fill of the same Across -> Executor -> Fly WETH lane verifies from its public callTracer tree", async () => {
  // Another user's fill (block 131908889). Its quote lets Fly keep all output above expected (10000 bps), as the quotes QA
  // drew on 2026-11-06 did; prepare decodes the same header, and the delivery tree is exactly what BSC executed.
  const real = lifiCapture("bsc-across-fly-fill-20261105.json") as { transaction: { hash: Hex; from: Address; to: Address; input: Hex };
    relay: { outputAmount: string; message: Hex }; trace: unknown };
  const [transactionId, , finalReceiver] = decodeAbiParameters(parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address"), real.relay.message);
  const realCall = decodeBnbCompositeMessage(real.relay.message, transactionId, finalReceiver);
  assert.deepEqual({ expected: realCall.expectedOutputAtomic, minimum: realCall.minimumOutputAtomic, retention: realCall.maximumRetentionBps },
    { expected: "385416243211316729", minimum: "371359950613945893", retention: 10_000 });
  assert.equal((await verifyFlyHeaderSignature(realCall, BNB_COMPOSITE.signer)).signer, BNB_COMPOSITE.signer);
  const fill = { sender: getAddress(real.transaction.from), target: getAddress(real.transaction.to), calldata: real.transaction.input, amountAtomic: real.relay.outputAmount };
  const proof = verifyBnbCompositeTrace(real.trace, real.transaction.hash, real.relay.message, realCall, fill);
  assert.deepEqual({ outcome: proof.outcome, gross: proof.vaultOutputAtomic, delivered: proof.deliveredAmountAtomic,
    retained: proof.retainedAmountAtomic, returned: proof.returnedWethAtomic },
  { outcome: "completed_native", gross: "385013129963143884", delivered: "385013129963143884", retained: "0", returned: "4222294866020" });
  assert.equal(verifyBnbCompositeTrace(real.trace, real.transaction.hash, real.relay.message, realCall,
    { ...fill, amountAtomic: (BigInt(fill.amountAtomic) - 1n).toString() }).outcome, "protocol_mismatch");
  // Had the signed expected output been one wei lower, the router would have kept that wei: paying it all is a mismatch.
  assert.equal(verifyBnbCompositeTrace(real.trace, real.transaction.hash, real.relay.message, { ...realCall,
    expectedOutputAtomic: "385013129963143883" }, fill).outcome, "protocol_mismatch");
});

test("QA's real fill whose Fly route hit its own deadline proves, from its public trace, that the whole fill came back as WETH", async () => {
  // Across deposit 4886518, filled through a relayer contract; a hop inside Fly's route reverted 0x3e9e7bf1(deadline, now).
  const real = lifiCapture("bsc-across-fly-revert-20261106.json") as { transaction: { hash: Hex; from: Address; to: Address; input: Hex };
    relay: { outputAmount: string; message: Hex }; trace: unknown };
  const [transactionId, , finalReceiver] = decodeAbiParameters(parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address"), real.relay.message);
  const realCall = decodeBnbCompositeMessage(real.relay.message, transactionId, finalReceiver);
  assert.equal((await verifyFlyHeaderSignature(realCall, BNB_COMPOSITE.signer)).signer, BNB_COMPOSITE.signer);
  const fill = { sender: getAddress(real.transaction.from), target: getAddress(real.transaction.to), calldata: real.transaction.input, amountAtomic: real.relay.outputAmount };
  const proof = verifyBnbCompositeTrace(real.trace, real.transaction.hash, real.relay.message, realCall, fill);
  assert.deepEqual({ outcome: proof.outcome, gross: proof.vaultOutputAtomic, delivered: proof.deliveredAmountAtomic, returned: proof.returnedWethAtomic },
    { outcome: "recovered_weth", gross: null, delivered: "0", returned: "286765125030554" });
  assert.equal(verifyBnbCompositeTrace(real.trace, real.transaction.hash, real.relay.message, realCall,
    { ...fill, amountAtomic: (BigInt(fill.amountAtomic) + 1n).toString() }).outcome, "protocol_mismatch");
});

test("reverted creations and reverted proxy calls are read for what they undid", () => {
  // callTracer omits the address of a CREATE2 that reverted; inside Fly Core that is just part of the route.
  const created = fillTrace(); at(created, CORE).calls.splice(1, 0, { type: "CREATE2", from: BNB_COMPOSITE.core, value: "0x0",
    input: "0x6080", error: "execution reverted", calls: [{ type: "CALL", from: "0x4444444444444444444444444444444444444444",
      to: BNB_COMPOSITE.flyRouter, value: "0x5", input: "0x" }] });
  assert.equal(verify(created).outcome, "completed_native");
  // A delivery made under a DELEGATECALL that reverted did not happen.
  const wrapped = fillTrace(), executor = at(wrapped, EXECUTOR), delivery = executor.calls.pop();
  executor.calls.push({ ...frame(BNB_COMPOSITE.executor, "0x4444444444444444444444444444444444444444", "0x12", 0n,
    [delivery], "0x", "DELEGATECALL"), error: "execution reverted" });
  assert.equal(verify(wrapped).outcome, "protocol_mismatch");
});
