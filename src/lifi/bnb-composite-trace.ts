import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { BNB_COMPOSITE, type BnbCompositeCall } from "./bnb-composite.js";
import { bridgeFailure, bridgeHex } from "./validation.js";

const TRACE_ABI = parseAbi([
  "function handleV3AcrossMessage(address tokenSent,uint256 amount,address relayer,bytes message)",
  "function swapAndCompleteBridgeTokens(bytes32 transactionId,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swaps,address transferredAssetId,address receiver)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
  "function transferFrom(address sender,address recipient,uint256 amount) returns (bool)",
]);
const TRACE_TYPES = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"]);
/** Frames whose value leaves `from` for `to`. A DELEGATECALL carries its caller's value and a CALLCODE pays itself. */
const VALUE_TRANSFERS = new Set(["CALL", "CREATE", "CREATE2", "SELFDESTRUCT"]);
const MAX_UINT256 = (1n << 256n) - 1n;
/**
 * Shape bounds on the decoded tree. Fly Core's route and a relayer's other fills in the same transaction are not ours to
 * size, so the bounds only keep the walk finite: the RPC answer itself is capped at 1 MiB.
 */
const TRACE_DEPTH = 64, TRACE_FRAMES = 8192, TRACE_CALLS = 2048, TRACE_HEX_BYTES = 1024 * 1024;

export type BnbDestinationOutcome = "completed_native" | "recovered_weth" | "below_floor" | "protocol_mismatch";
export interface BnbCompositeTraceProof {
  readonly outcome: BnbDestinationOutcome;
  readonly transactionHash: Hex;
  readonly inputAmountAtomic: string;
  /** The native value Fly's router received from Core in the swap: the gross output before the signed retention. */
  readonly vaultOutputAtomic: string | null;
  readonly deliveredAmountAtomic: string;
  readonly retainedAmountAtomic: string;
  /** WETH sent back to the recipient: the fill above the Fly input, or the whole fill when the swap reverted. */
  readonly returnedWethAtomic: string;
  readonly traceHash: string;
}
/** `to` is null only for a reverted CREATE or CREATE2, which callTracer reports without the address it never got. */
type TraceNode = Readonly<{ type: string; from: Address; to: Address | null; value: bigint; input: Hex; output: Hex;
  error: string | null; calls: readonly TraceNode[] }>;
/** The destination transaction (its sender, target, value and calldata bind the trace to it) and the fill amount its FilledRelay proved. */
export interface BnbDestinationFill {
  readonly sender: Address;
  readonly target: Address;
  readonly valueAtomic: string;
  readonly calldata: Hex;
  readonly amountAtomic: string;
}

/**
 * Validate the bounded callTracer tree of the Across fill into the Across/Fly composite. Proxies (the SpokePool, BSC's
 * Binance-peg WETH) run through DELEGATECALL and contracts read balances and allowances through STATICCALL; neither
 * moves value, so each frame's effects are its state-changing calls with those wrappers and reads looked through.
 * Every effect of the Receiver, the Executor and Fly's router is exact. Inside the router's call to Fly Core the route is
 * Fly's choice for the quote and is not interpreted: only its native settlement is, the net value it paid the router and
 * any it paid the Executor directly. The router's signed retention rule must turn the first into its payment to the
 * Executor, and the Executor must forward exactly what it received, after returning the WETH the swap did not take. The
 * digest covers every normalized frame, including read-only ones. A well-formed but different effect graph is a durable
 * mismatch rather than an invitation to retry the source transaction.
 */
export function verifyBnbCompositeTrace(raw: unknown, transactionHash: Hex, message: Hex,
  call: BnbCompositeCall, fill: BnbDestinationFill): BnbCompositeTraceProof {
  const root = traceNode(raw, { count: 0 }, 0), reported = raw as Record<string, unknown>;
  const traceHash = hashObject({ transactionHash, root: traceProjection(root) });
  const input = BigInt(call.inputAmountAtomic), filled = BigInt(fill.amountAtomic);
  // The root must be the verified transaction itself. A trace of anything else says nothing about this fill, so it is an
  // RPC answer to read again (retryable), never a terminal outcome. Addresses are checksummed on both sides. callTracer
  // always reports the top call's value and input, so the root must carry both: inner frames may omit them, the root not.
  if (root.type !== "CALL" || root.error !== null || reported.value === undefined || reported.input === undefined ||
    root.from !== getAddress(fill.sender) || root.to !== getAddress(fill.target) ||
    root.value !== BigInt(fill.valueAtomic) || root.input !== fill.calldata) bridgeFailure("APN_RPC_PROTOCOL", "native_trace_transaction");
  try {
    assertCallerTree(root);
    if (filled < input) mismatch();
    // A relayer may batch fills: exactly one live SpokePool call to the Receiver carries this deposit's message.
    const handlers = live(root).filter((frame) => frame.type === "CALL" && frame.from === BNB_COMPOSITE.spokePool &&
      frame.to === BNB_COMPOSITE.receiver && handlerMessage(frame) === message);
    if (handlers.length !== 1) mismatch();
    const handler = handlers[0]!, h = decode(handler.input, "handleV3AcrossMessage") as readonly [Address, bigint, Address, Hex];
    if (handler.value !== 0n || h[0] !== BNB_COMPOSITE.weth || h[1] !== filled) mismatch();
    const receiverEffects = effects(handler);
    exactToken(receiverEffects[0], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, filled]);
    const executor = receiverEffects[1];
    if (executor === undefined || executor.type !== "CALL" || executor.to !== BNB_COMPOSITE.executor || executor.value !== 0n ||
      executor.input.slice(0, 10) !== "0x4f91bc2b") mismatch();
    const executorArgs = decode(executor.input, "swapAndCompleteBridgeTokens") as readonly [Hex, readonly any[], Address, Address];
    if (executorArgs[0] !== call.transactionId || executorArgs[1].length !== 1 || executorArgs[2] !== BNB_COMPOSITE.weth || executorArgs[3] !== call.finalReceiver) mismatch();
    const swap = executorArgs[1][0] as Record<string, unknown>;
    if (swap.callTo !== BNB_COMPOSITE.flyRouter || swap.approveTo !== BNB_COMPOSITE.flyRouter || swap.sendingAssetId !== BNB_COMPOSITE.weth ||
      swap.receivingAssetId !== "0x0000000000000000000000000000000000000000" || String(swap.fromAmount) !== call.inputAmountAtomic ||
      swap.callData !== call.flyCalldata || swap.requiresDeposit !== true) mismatch();

    if (executor.error !== null) {
      // The Receiver caught the reverted Executor (everything under it reverted too) and sent the whole fill back as WETH.
      if (receiverEffects.length !== 4) mismatch();
      exactToken(receiverEffects[2], BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, filled]);
      exactToken(receiverEffects[3], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, 0n]);
      return { outcome: "recovered_weth", transactionHash, inputAmountAtomic: call.inputAmountAtomic, vaultOutputAtomic: null,
        deliveredAmountAtomic: "0", retainedAmountAtomic: "0", returnedWethAtomic: filled.toString(), traceHash };
    }
    if (receiverEffects.length !== 3) mismatch();
    exactToken(receiverEffects[2], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, 0n]);
    const executorEffects = effects(executor);
    let next = 0;
    exactToken(executorEffects[next++], BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.receiver, BNB_COMPOSITE.executor, filled]);
    // `LibAsset.maxApproveERC20` resets and raises the allowance only when the standing one is below the swap amount.
    if (isToken(executorEffects[next], BNB_COMPOSITE.weth, "approve")) {
      exactToken(executorEffects[next++], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.flyRouter, 0n]);
      exactToken(executorEffects[next++], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.flyRouter, MAX_UINT256]);
    }
    const fly = executorEffects[next++];
    if (fly === undefined || fly.type !== "CALL" || fly.to !== BNB_COMPOSITE.flyRouter || fly.value !== 0n || fly.input !== call.flyCalldata || fly.error !== null) mismatch();
    // The fill above the Fly input stays with the Executor, which returns it to the recipient as WETH.
    const returned = filled - input;
    if (returned > 0n) exactToken(executorEffects[next++], BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, returned]);
    const delivered = executorEffects[next++];
    if (next !== executorEffects.length || delivered === undefined || delivered.type !== "CALL" || delivered.to !== call.finalReceiver ||
      delivered.value <= 0n || delivered.input !== "0x" || delivered.error !== null) mismatch();

    const flyEffects = effects(fly);
    exactToken(flyEffects[0], BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.executor, BNB_COMPOSITE.core, input]);
    const core = flyEffects[1];
    if (core === undefined || core.type !== "CALL" || core.to !== BNB_COMPOSITE.core || core.error !== null ||
      core.value !== 0n || core.input !== coreInvocation(call.flyCalldata)) mismatch();
    const flyReturn = flyEffects[2];
    if (flyEffects.length !== 3 || flyReturn === undefined || flyReturn.type !== "CALL" || flyReturn.to !== BNB_COMPOSITE.executor ||
      flyReturn.input !== "0x" || flyReturn.error !== null || effects(flyReturn).length !== 0) mismatch();

    // The router's own balance change across Core is its `transferredAmountOut`; value Core paid the Executor directly
    // also counts toward the Executor's `amountOut` and is forwarded with the rest.
    const gross = netNative(core, BNB_COMPOSITE.flyRouter), direct = netNative(core, BNB_COMPOSITE.executor);
    if (gross <= 0n || direct < 0n) mismatch();
    const routerPaid = retainedOutput(gross, BigInt(call.expectedOutputAtomic), BigInt(call.maximumRetentionBps));
    if (flyReturn.value !== routerPaid || delivered.value !== routerPaid + direct) mismatch();
    return { outcome: delivered.value < BigInt(call.minimumOutputAtomic) ? "below_floor" : "completed_native", transactionHash,
      inputAmountAtomic: call.inputAmountAtomic, vaultOutputAtomic: gross.toString(), deliveredAmountAtomic: delivered.value.toString(),
      retainedAmountAtomic: (gross - routerPaid).toString(), returnedWethAtomic: returned.toString(), traceHash };
  } catch (error) {
    if (error instanceof TraceMismatch) return { outcome: "protocol_mismatch", transactionHash, inputAmountAtomic: call.inputAmountAtomic,
      vaultOutputAtomic: null, deliveredAmountAtomic: "0", retainedAmountAtomic: "0", returnedWethAtomic: "0", traceHash };
    throw error;
  }
}

class TraceMismatch extends Error {}
function mismatch(): never { throw new TraceMismatch(); }
/** `DexAggregator.swap` with `transferFromRouter` false: everything up to the expected output, else at most the retention. */
function retainedOutput(actual: bigint, expected: bigint, retentionBps: bigint): bigint {
  return actual <= expected ? actual : [expected, actual - actual * retentionBps / 10_000n].reduce((a, b) => a > b ? a : b);
}
/** Value `account` gained in this subtree; a reverted frame undoes its own transfer and every frame beneath it. */
function netNative(node: TraceNode, account: Address): bigint {
  if (node.error !== null) return 0n;
  let net = 0n;
  if (VALUE_TRANSFERS.has(node.type)) { if (node.to === account) net += node.value; if (node.from === account) net -= node.value; }
  for (const child of node.calls) net += netNative(child, account);
  return net;
}
function traceNode(raw: unknown, bounded: { count: number }, depth: number): TraceNode {
  if (depth > TRACE_DEPTH || ++bounded.count > TRACE_FRAMES || raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("bnb_trace_shape");
  const r = raw as Record<string, unknown>, allowed = new Set(["type", "from", "to", "value", "input", "output", "error", "revertReason", "calls", "gas", "gasUsed"]);
  if (Object.keys(r).some((key) => !allowed.has(key)) || typeof r.type !== "string" || !TRACE_TYPES.has(r.type)) fail("bnb_trace_shape");
  const calls = r.calls === undefined ? [] : r.calls;
  if (!Array.isArray(calls) || calls.length > TRACE_CALLS) fail("bnb_trace_shape");
  const failedCreate = (r.type === "CREATE" || r.type === "CREATE2") && typeof r.error === "string" && r.to === undefined;
  let from: Address, to: Address | null, input: Hex, output: Hex, value: bigint;
  try {
    from = getAddress(String(r.from)); to = failedCreate ? null : getAddress(String(r.to));
    input = bridgeHex(r.input ?? "0x", TRACE_HEX_BYTES); output = bridgeHex(r.output ?? "0x", TRACE_HEX_BYTES); value = BigInt(String(r.value ?? "0x0"));
  }
  catch { return fail("bnb_trace_shape"); }
  if (value < 0n || (r.error !== undefined && typeof r.error !== "string")) fail("bnb_trace_shape");
  return { type: r.type, from, to, value, input, output, error: r.error === undefined ? null : r.error as string,
    calls: calls.map((child) => traceNode(child, bounded, depth + 1)) };
}
/** Frames that took effect: none under a reverted frame. */
function live(node: TraceNode): readonly TraceNode[] { return node.error !== null ? [] : [node, ...node.calls.flatMap(live)]; }
/**
 * The calls a frame made itself, through proxy DELEGATECALLs and without STATICCALL reads, which move no value. A
 * reverted DELEGATECALL stays as itself, so the exact checks see it instead of the calls it undid.
 */
function effects(node: TraceNode): readonly TraceNode[] {
  return node.calls.flatMap((child) => child.type === "STATICCALL" ? []
    : child.type === "DELEGATECALL" ? child.error !== null ? [child] : effects(child) : [child]);
}
function handlerMessage(frame: TraceNode): Hex | null {
  try { const d = decodeFunctionData({ abi: TRACE_ABI, data: frame.input }); return d.functionName === "handleV3AcrossMessage" ? d.args[3] as Hex : null; }
  catch { return null; }
}
function traceProjection(node: TraceNode): unknown { return { ...node, value: node.value.toString(), calls: node.calls.map(traceProjection) }; }
/**
 * Code run by DELEGATECALL or CALLCODE executes as its caller, so the calls it makes come from the caller's address. A
 * reverted CREATE has no reported address to compare its constructor's calls with; they were undone with it.
 */
function assertCallerTree(node: TraceNode): void {
  const context = node.type === "DELEGATECALL" || node.type === "CALLCODE" ? node.from : node.to;
  for (const child of node.calls) { if (context !== null && child.from !== context) mismatch(); assertCallerTree(child); }
}
function decode(input: Hex, name: string): readonly unknown[] {
  try { const d = decodeFunctionData({ abi: TRACE_ABI, data: input }); if (d.functionName !== name) mismatch(); return d.args as readonly unknown[]; }
  catch (error) { if (error instanceof TraceMismatch) throw error; return mismatch(); }
}
function isToken(node: TraceNode | undefined, token: Address, name: "approve" | "transfer" | "transferFrom"): boolean {
  if (node === undefined || node.type !== "CALL" || node.to !== token) return false;
  try { return decodeFunctionData({ abi: TRACE_ABI, data: node.input }).functionName === name; } catch { return false; }
}
function exactToken(node: TraceNode | undefined, token: Address, name: "approve" | "transfer" | "transferFrom", args: readonly unknown[]): void {
  if (node === undefined || node.type !== "CALL" || node.to !== token || node.error !== null || node.value !== 0n ||
    node.output !== `0x${"0".repeat(63)}1` || effects(node).length !== 0) mismatch();
  const got = decode(node.input, name); if (got.length !== args.length || got.some((v, i) => String(v) !== String(args[i]))) mismatch();
}
/** The router's call to Core: `swapWithoutSignature` over the same ABI head and payload (amount and input asset already equal). */
function coreInvocation(flyCalldata: Hex): Hex {
  const raw = Buffer.from(flyCalldata.slice(2), "hex");
  if (raw.length < 68) return mismatch();
  const payloadLength = Number(BigInt(`0x${raw.subarray(36, 68).toString("hex")}`));
  if (payloadLength <= 0 || 68 + payloadLength > raw.length) return mismatch();
  const selector = Buffer.from("158f6894", "hex"), head = raw.subarray(4, 68), payload = raw.subarray(68, 68 + payloadLength);
  return `0x${Buffer.concat([selector, head, payload]).toString("hex")}`;
}
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", reason); }
