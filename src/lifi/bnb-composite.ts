import { concatHex, decodeAbiParameters, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, parseAbiParameters, recoverTypedDataAddress } from "viem";
import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { bridgeFailure, bridgeHex } from "./validation.js";

export const BNB_COMPOSITE = Object.freeze({
  chainId: 56 as const,
  receiver: getAddress("0x33b255b5db44A78c34381f89f1a454bc0Ef49871"),
  spokePool: getAddress("0x4e8e101924ede233c13e2d8622dc8aed2872d505"),
  executor: getAddress("0x2dfaDAB8266483beD9Fd9A292Ce56596a2D1378D"),
  flyRouter: getAddress("0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c"),
  core: getAddress("0x09ad820aac5779683b481c4674208a4e1b024afa"),
  weth: getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8"),
  wbnb: getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
  vault: getAddress("0xA82f327BBbf0667356d2935c6532D164B06cEceD"),
  pool: getAddress("0xaEcf01c5a659d74Dc33C9C922a4458eAB0b13DeA"),
  poolId: "0xaecf01c5a659d74dc33c9c922a4458eab0b13dea000100000000000000000012" as Hex,
  poolTokens: [getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8"), getAddress("0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47"),
    getAddress("0x570A5D26f7765Ecb712C0924E4De545B89fD43dF"), getAddress("0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402"),
    getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")] as const,
  selector: "0x46ec278a" as Hex,
  balancerSelector: "0x52bbbe29" as Hex,
  signer: getAddress("0x28de4113921BD79388B0ef80A259f871977442E9"),
  commandDescriptors: ["010000015a01650000", "00002001a301d0013f", "05000001d001d60000",
    "06002001d601d90000", "03000001d901e00000"] as const,
});

const DESTINATION_MESSAGE = parseAbiParameters("bytes32 transactionId, (address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swaps, address finalReceiver");
// Frozen verified program shape with only quote/header values zeroed. This makes every VM byte and sequence pointer fail closed.
const FLY_PROGRAM_SHAPE = "019a00402dfadab8266483bed9fd9a292ce56596a2d1378d2170ed0880ac9a755fd29b2688956bd959f933f800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e00114c80119c801210000000000000000000000000000000000000000000000000000000000000000f0012900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000c800000000000000c800000000000000f000002170ed0880ac9a755fd29b2688956bd959f933f8a82f327bbbf0667356d2935c6532d164b06cecedd000000000000002012b02013f0e0153015352bbbe29f8e0f800aecf01c5a659d74dc33c9c922a4458eab0b13dea000100000000000000000012bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095cf8c00101650301690603016b0603016b03016b03011304016d002003016b02012b02018d0e015301530301a103016b02018d05000002007002007007050020010000015a0165000000002001a301d0013f05000001d001d6000006002001d601d9000003000001d901e00000";
const VAULT_READ = parseAbi([
  "function getPool(bytes32 poolId) view returns (address poolAddress,uint8 specialization)",
  "function getPoolTokens(bytes32 poolId) view returns (address[] tokens,uint256[] balances,uint256 lastChangeBlock)",
]);

export interface BnbCompositeCall {
  readonly kind: "across-fly-bnb";
  readonly transactionId: Hex;
  readonly finalReceiver: Address;
  readonly inputAmountAtomic: string;
  readonly expectedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly deadlineAtomic: string;
  readonly maximumRetentionBps: number;
  readonly consumerId: Hex;
  readonly signature: Hex;
  readonly flyCalldata: Hex;
  readonly payloadHash: Hex;
  readonly messageHash: Hex;
}

/** Strict parser for the one reviewed LI.FI ReceiverAcrossV4 -> Executor -> Fly program. */
export function decodeBnbCompositeMessage(message: Hex, expectedTransactionId: Hex, expectedRecipient: Address): BnbCompositeCall {
  let decoded: readonly unknown[];
  try { decoded = decodeAbiParameters(DESTINATION_MESSAGE, message); } catch { return fail("bnb_message_abi"); }
  if (encodeAbiParameters(DESTINATION_MESSAGE, decoded as never) !== message) fail("bnb_message_noncanonical");
  const [transactionId, swaps, finalReceiver] = decoded as unknown as readonly [Hex, readonly Readonly<{
    callTo: Address; approveTo: Address; sendingAssetId: Address; receivingAssetId: Address; fromAmount: bigint; callData: Hex; requiresDeposit: boolean;
  }>[], Address];
  if (transactionId.toLowerCase() !== expectedTransactionId.toLowerCase() || finalReceiver !== expectedRecipient || swaps.length !== 1) fail("bnb_message_binding");
  const swap = swaps[0]!;
  if (swap.callTo !== BNB_COMPOSITE.flyRouter || swap.approveTo !== BNB_COMPOSITE.flyRouter || swap.sendingAssetId !== BNB_COMPOSITE.weth ||
      swap.receivingAssetId !== "0x0000000000000000000000000000000000000000" || swap.fromAmount <= 0n || !swap.requiresDeposit) fail("bnb_destination_swap");
  const program = decodeFlyProgram(swap.callData, expectedRecipient, swap.fromAmount);
  return { kind: "across-fly-bnb", transactionId, finalReceiver, inputAmountAtomic: swap.fromAmount.toString(),
    expectedOutputAtomic: program.expectedOutputAtomic, minimumOutputAtomic: program.minimumOutputAtomic,
    deadlineAtomic: program.deadlineAtomic, maximumRetentionBps: program.maximumRetentionBps,
    consumerId: program.consumerId, signature: program.signature, flyCalldata: swap.callData,
    payloadHash: program.payloadHash, messageHash: keccak256(message) };
}

export function decodeFlyProgram(calldata: Hex, _expectedRecipient: Address, expectedAmount: bigint): Omit<BnbCompositeCall, "kind" | "transactionId" | "finalReceiver" | "inputAmountAtomic" | "messageHash" | "flyCalldata"> {
  const raw = Buffer.from(bridgeHex(calldata, 2048).slice(2), "hex");
  if (raw.length < 4 + 64 || `0x${raw.subarray(0, 4).toString("hex")}` !== BNB_COMPOSITE.selector) fail("fly_selector");
  const offset = uint(raw, 4, 32), length = uint(raw, 36, 32);
  if (offset !== 32n || length > 1024n) fail("fly_abi_bounds");
  const payloadStart = 68, payloadEnd = payloadStart + Number(length), paddedEnd = payloadStart + Math.ceil(Number(length) / 32) * 32;
  if (paddedEnd !== raw.length || raw.subarray(payloadEnd).some(Boolean)) fail("fly_abi_padding");
  const p = raw.subarray(payloadStart, payloadEnd);
  if (p.length !== 457 || Number(uint(p, 0, 2)) !== 410 || Number(uint(p, 2, 2)) !== 64) fail("fly_program_header");
  const shape = Buffer.from(p);
  for (const [start, end] of [[64, 96], [105, 137], [141, 206], [208, 212], [213, 220], [221, 228], [229, 231], [272, 278]]) shape.fill(0, start, end);
  if (shape.toString("hex") !== FLY_PROGRAM_SHAPE) fail("fly_program_shape");
  // Fly's signed consumer is LI.FI's Executor; the final self recipient is independently bound by the enclosing message.
  address(p, 4, BNB_COMPOSITE.executor, "fly_recipient"); address(p, 24, BNB_COMPOSITE.weth, "fly_input");
  address(p, 44, "0x0000000000000000000000000000000000000000", "fly_output");
  if (uint(p, 64, 32) !== expectedAmount) fail("fly_amount");
  const deadline = compact(p, 96), minimum = compact(p, 99), expected = compact(p, 102), retention = compact(p, 137);
  if (deadline <= 0n || minimum <= 0n || expected < minimum || retention > 500n) fail("fly_economics");
  if (p[140] !== 0) fail("fly_transfer_mode");
  if (p[206] !== 0) fail("fly_fee_count");
  address(p, 231, BNB_COMPOSITE.weth, "fly_vm_weth"); address(p, 251, BNB_COMPOSITE.vault, "fly_vm_vault");
  if (p[271] !== 0xd0 || uint(p, 272, 6) !== expectedAmount) fail("fly_vm_amount");
  if (`0x${p.subarray(289, 293).toString("hex")}` !== BNB_COMPOSITE.balancerSelector ||
      `0x${p.subarray(297, 329).toString("hex")}` !== BNB_COMPOSITE.poolId) fail("fly_balancer");
  address(p, 329, BNB_COMPOSITE.wbnb, "fly_vm_wbnb");
  const commands = p.subarray(412);
  if (commands.length !== 45 || BNB_COMPOSITE.commandDescriptors.some((x, i) => commands.subarray(i * 9, i * 9 + 9).toString("hex") !== x)) fail("fly_commands");
  const consumerId = `0x${p.subarray(105, 137).toString("hex")}` as Hex;
  const signature = concatHex([`0x${p.subarray(141, 173).toString("hex")}`, `0x${p.subarray(173, 205).toString("hex")}`,
    `0x${p.subarray(205, 206).toString("hex")}`]);
  return { deadlineAtomic: deadline.toString(), minimumOutputAtomic: minimum.toString(), expectedOutputAtomic: expected.toString(),
    maximumRetentionBps: Number(retention), consumerId, signature, payloadHash: keccak256(`0x${p.toString("hex")}`) };
}

/** Rebuild Fly's exact no-fee EIP-712 header authorization; command integrity remains the parser's responsibility. */
export async function verifyFlyHeaderSignature(call: Pick<BnbCompositeCall, "deadlineAtomic" | "minimumOutputAtomic" | "expectedOutputAtomic" | "maximumRetentionBps" | "consumerId" | "signature">,
  authorizedSigner: Address): Promise<Readonly<{ digest: Hex; signer: Address }>> {
  const typed = { domain: { name: "Dex Aggregator", version: "1", chainId: 56, verifyingContract: BNB_COMPOSITE.flyRouter },
    primaryType: "Swap" as const,
    types: { Swap: [
      { name: "router", type: "address" }, { name: "sender", type: "address" }, { name: "recipient", type: "address" },
      { name: "fromAsset", type: "address" }, { name: "toAsset", type: "address" }, { name: "deadline", type: "uint256" },
      { name: "amountOutMin", type: "uint256" }, { name: "expectedAmountOut", type: "uint256" }, { name: "consumerId", type: "bytes32" },
      { name: "maxRetentionBps", type: "uint256" }, { name: "transferFromRouter", type: "bool" },
    ] },
    message: { router: BNB_COMPOSITE.flyRouter, sender: BNB_COMPOSITE.executor, recipient: BNB_COMPOSITE.executor,
      fromAsset: BNB_COMPOSITE.weth, toAsset: "0x0000000000000000000000000000000000000000",
      deadline: BigInt(call.deadlineAtomic), amountOutMin: BigInt(call.minimumOutputAtomic), expectedAmountOut: BigInt(call.expectedOutputAtomic),
      consumerId: call.consumerId, maxRetentionBps: BigInt(call.maximumRetentionBps), transferFromRouter: false } } as const;
  const digest = hashTypedData(typed);
  let signer: Address;
  try { signer = getAddress(await recoverTypedDataAddress({ ...typed, signature: call.signature })); } catch { return fail("fly_signature"); }
  if (signer !== authorizedSigner) fail("fly_signer");
  return { digest, signer };
}

export const bnbPoolReadData = Object.freeze({
  registration: encodeFunctionData({ abi: VAULT_READ, functionName: "getPool", args: [BNB_COMPOSITE.poolId] }),
  tokens: encodeFunctionData({ abi: VAULT_READ, functionName: "getPoolTokens", args: [BNB_COMPOSITE.poolId] }),
});

/** Fail-closed semantic decoding avoids pinning mutable balances while pinning the pool registration and token order. */
export function verifyBnbPoolConfiguration(registrationRaw: Hex, tokensRaw: Hex): Readonly<{ pool: Address; specialization: number; tokens: readonly Address[]; lastChangeBlockAtomic: string }> {
  let registration: readonly [Address, number], tokenState: readonly [readonly Address[], readonly bigint[], bigint];
  try {
    registration = decodeFunctionResult({ abi: VAULT_READ, functionName: "getPool", data: bridgeHex(registrationRaw, 256) }) as typeof registration;
    tokenState = decodeFunctionResult({ abi: VAULT_READ, functionName: "getPoolTokens", data: bridgeHex(tokensRaw, 2048) }) as typeof tokenState;
  } catch { return fail("bnb_pool_return"); }
  const pool = getAddress(BNB_COMPOSITE.poolId.slice(0, 42));
  if (registration[0] !== pool || registration[1] !== 1 || tokenState[0].length !== BNB_COMPOSITE.poolTokens.length ||
      tokenState[1].length !== BNB_COMPOSITE.poolTokens.length || tokenState[0].some((token, index) => token !== BNB_COMPOSITE.poolTokens[index]) ||
      tokenState[0][0] !== BNB_COMPOSITE.weth || tokenState[0].at(-1) !== BNB_COMPOSITE.wbnb || tokenState[2] <= 0n) fail("bnb_pool_configuration");
  return { pool, specialization: 1, tokens: tokenState[0], lastChangeBlockAtomic: tokenState[2].toString() };
}

const TRACE_ABI = parseAbi([
  "function handleV3AcrossMessage(address tokenSent,uint256 amount,address relayer,bytes message)",
  "function swapAndCompleteBridgeTokens(bytes32 transactionId,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swaps,address transferredAssetId,address receiver)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
  "function transferFrom(address sender,address recipient,uint256 amount) returns (bool)",
  "function withdraw(uint256 amount)",
  "function swap((bytes32 poolId,uint8 kind,address assetIn,address assetOut,uint256 amount,bytes userData) singleSwap,(address sender,bool fromInternalBalance,address recipient,bool toInternalBalance) funds,uint256 limit,uint256 deadline) returns (uint256 amountCalculated)",
  "function onSwap((uint8 kind,address tokenIn,address tokenOut,uint256 amount,bytes32 poolId,uint256 lastChangeBlock,address from,address to,bytes userData) request,uint256 balanceTokenIn,uint256 balanceTokenOut) view returns (uint256 amount)",
]);
export type BnbDestinationOutcome = "completed_native" | "recovered_weth" | "below_floor" | "protocol_mismatch";
export interface BnbCompositeTraceProof {
  readonly outcome: BnbDestinationOutcome;
  readonly transactionHash: Hex;
  readonly inputAmountAtomic: string;
  readonly vaultOutputAtomic: string | null;
  readonly deliveredAmountAtomic: string;
  readonly retainedAmountAtomic: string;
  readonly traceHash: string;
}
type TraceNode = Readonly<{ type: "CALL" | "STATICCALL"; from: Address; to: Address; value: bigint; input: Hex; output: Hex;
  error: string | null; calls: readonly TraceNode[] }>;
export interface BnbDestinationTransaction {
  readonly sender: Address;
  readonly calldata: Hex;
}

/**
 * Validate the complete bounded callTracer subtree for the one admitted Across/Fly program. The digest covers every
 * normalized frame, including read-only frames. A well-formed but different effect graph is a durable mismatch rather
 * than an invitation to retry the source transaction.
 */
export function verifyBnbCompositeTrace(raw: unknown, transactionHash: Hex, message: Hex,
  call: BnbCompositeCall, transaction: BnbDestinationTransaction): BnbCompositeTraceProof {
  const root = traceNode(raw, { count: 0 }, 0);
  const traceHash = hashObject({ transactionHash, root: traceProjection(root) });
  try {
    assertCallerTree(root);
    if (transaction.calldata.length < 10 || root.from !== transaction.sender || root.input !== transaction.calldata) mismatch();
    exactFrame(root, BNB_COMPOSITE.spokePool, transaction.calldata.slice(0, 10) as Hex, "spoke");
    const spokeEffects = root.calls;
    if (spokeEffects.length !== 2) mismatch();
    exactToken(spokeEffects[0], BNB_COMPOSITE.weth, "transfer", [BNB_COMPOSITE.receiver, BigInt(call.inputAmountAtomic)]);
    const receiver = spokeEffects[1]!;
    exactFrame(receiver, BNB_COMPOSITE.receiver, "0x3a5be8cb", "receiver");
    const h = decode(receiver.input, "handleV3AcrossMessage") as readonly [Address, bigint, Address, Hex];
    if (h[0] !== BNB_COMPOSITE.weth || h[1].toString() !== call.inputAmountAtomic || h[3] !== message) mismatch();
    const receiverEffects = receiver.calls;
    exactToken(receiverEffects[0], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, BigInt(call.inputAmountAtomic)]);
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
      if (receiverEffects.length !== 4) mismatch();
      if (walk(executor).some((frame) => frame.type === "CALL" && frame.to === call.finalReceiver && frame.value > 0n && frame.error === null)) mismatch();
      exactToken(receiverEffects[2], BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, BigInt(call.inputAmountAtomic)]);
      exactToken(receiverEffects[3], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, 0n]);
      return { outcome: "recovered_weth", transactionHash, inputAmountAtomic: call.inputAmountAtomic,
        vaultOutputAtomic: null, deliveredAmountAtomic: "0", retainedAmountAtomic: "0", traceHash };
    }
    if (receiverEffects.length !== 3) mismatch();
    exactToken(receiverEffects[2], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, 0n]);
    const executorEffects = executor.calls;
    exactToken(executorEffects[0], BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.receiver, BNB_COMPOSITE.executor, BigInt(call.inputAmountAtomic)]);
    exactToken(executorEffects[1], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.flyRouter, BigInt(call.inputAmountAtomic)]);
    const fly = executorEffects[2];
    if (fly === undefined || fly.type !== "CALL" || fly.to !== BNB_COMPOSITE.flyRouter || fly.value !== 0n || fly.input !== call.flyCalldata || fly.error !== null) mismatch();
    const delivered = executorEffects[3];
    if (executorEffects.length !== 4 || delivered === undefined || delivered.type !== "CALL" || delivered.to !== call.finalReceiver || delivered.value <= 0n ||
      delivered.input !== "0x" || delivered.output !== "0x" || delivered.error !== null || delivered.calls.length !== 0) mismatch();

    const flyEffects = fly.calls;
    exactToken(flyEffects[0], BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.executor, BNB_COMPOSITE.core, BigInt(call.inputAmountAtomic)]);
    const core = flyEffects[1];
    if (core === undefined || core.type !== "CALL" || core.to !== BNB_COMPOSITE.core || core.error !== null ||
      core.value !== 0n || core.input !== coreInvocation(call.flyCalldata)) mismatch();
    const flyReturn = flyEffects[2];
    if (flyEffects.length !== 3 || flyReturn === undefined || flyReturn.type !== "CALL" || flyReturn.to !== BNB_COMPOSITE.executor ||
      flyReturn.input !== "0x" || flyReturn.output !== "0x" || flyReturn.error !== null || flyReturn.calls.length !== 0) mismatch();

    const coreEffects = core.calls;
    exactToken(coreEffects[0], BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.vault, BigInt(call.inputAmountAtomic)]);
    const vault = coreEffects[1];
    if (vault === undefined || vault.type !== "CALL" || vault.to !== BNB_COMPOSITE.vault || vault.error !== null || vault.value !== 0n ||
      vault.input.slice(0, 10) !== BNB_COMPOSITE.balancerSelector) mismatch();
    const v = decode(vault.input, "swap") as readonly [any, any, bigint, bigint];
    if (v[0].poolId !== BNB_COMPOSITE.poolId || Number(v[0].kind) !== 0 || v[0].assetIn !== BNB_COMPOSITE.weth ||
      v[0].assetOut !== BNB_COMPOSITE.wbnb || String(v[0].amount) !== call.inputAmountAtomic || v[0].userData !== "0x" ||
      v[1].sender !== BNB_COMPOSITE.core || v[1].recipient !== BNB_COMPOSITE.core || v[1].fromInternalBalance !== false ||
      v[1].toInternalBalance !== false || v[2] !== 0n || v[3].toString() !== call.deadlineAtomic) mismatch();
    if (!/^0x[0-9a-f]{64}$/u.test(vault.output)) mismatch();
    const vaultOutput = BigInt(vault.output);
    if (vaultOutput <= 0n) mismatch();
    if (vault.calls.length !== 3) mismatch();
    const pool = vault.calls[0];
    if (pool === undefined || pool.type !== "STATICCALL" || pool.to !== BNB_COMPOSITE.pool || pool.error !== null || pool.value !== 0n ||
      pool.output !== vault.output) mismatch();
    const poolArgs = decode(pool.input, "onSwap") as readonly [any, bigint, bigint], request = poolArgs[0];
    if (Number(request.kind) !== 0 || request.tokenIn !== BNB_COMPOSITE.weth || request.tokenOut !== BNB_COMPOSITE.wbnb ||
      String(request.amount) !== call.inputAmountAtomic || request.poolId !== BNB_COMPOSITE.poolId || request.from !== BNB_COMPOSITE.core ||
      request.to !== BNB_COMPOSITE.core || request.userData !== "0x" || BigInt(request.lastChangeBlock) <= 0n || poolArgs[1] <= 0n || poolArgs[2] <= 0n) mismatch();
    exactToken(vault.calls[1], BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.core, BNB_COMPOSITE.vault, BigInt(call.inputAmountAtomic)]);
    exactToken(vault.calls[2], BNB_COMPOSITE.wbnb, "transfer", [BNB_COMPOSITE.core, vaultOutput]);
    const unwrap = coreEffects[2];
    if (unwrap === undefined || unwrap.type !== "CALL" || unwrap.to !== BNB_COMPOSITE.wbnb || unwrap.error !== null || unwrap.value !== 0n || unwrap.output !== "0x" ||
      (decode(unwrap.input, "withdraw") as readonly [bigint])[0] !== vaultOutput) mismatch();
    const unwrapReturn = unwrap.calls[0];
    if (unwrap.calls.length !== 1 || unwrapReturn === undefined || unwrapReturn.type !== "CALL" || unwrapReturn.to !== BNB_COMPOSITE.core ||
      unwrapReturn.input !== "0x" || unwrapReturn.value !== vaultOutput || unwrapReturn.output !== "0x" || unwrapReturn.error !== null || unwrapReturn.calls.length !== 0) mismatch();
    const coreReturn = coreEffects[3];
    if (coreEffects.length !== 4 || coreReturn === undefined || coreReturn.type !== "CALL" || coreReturn.to !== BNB_COMPOSITE.flyRouter ||
      coreReturn.input !== "0x" || coreReturn.output !== "0x" || coreReturn.value !== vaultOutput || coreReturn.error !== null || coreReturn.calls.length !== 0) mismatch();
    const expectedDelivered = retainedOutput(vaultOutput, BigInt(call.expectedOutputAtomic), BigInt(call.maximumRetentionBps));
    if (flyReturn.value !== expectedDelivered || delivered.value !== expectedDelivered) mismatch();
    const retained = vaultOutput - expectedDelivered;
    return { outcome: delivered.value < BigInt(call.minimumOutputAtomic) ? "below_floor" : "completed_native", transactionHash,
      inputAmountAtomic: call.inputAmountAtomic, vaultOutputAtomic: vaultOutput.toString(), deliveredAmountAtomic: delivered.value.toString(),
      retainedAmountAtomic: retained.toString(), traceHash };
  } catch (error) {
    if (error instanceof TraceMismatch) return { outcome: "protocol_mismatch", transactionHash, inputAmountAtomic: call.inputAmountAtomic,
      vaultOutputAtomic: null, deliveredAmountAtomic: "0", retainedAmountAtomic: "0", traceHash };
    throw error;
  }
}

class TraceMismatch extends Error {}
function mismatch(): never { throw new TraceMismatch(); }
function retainedOutput(actual: bigint, expected: bigint, retentionBps: bigint): bigint {
  return actual <= expected ? actual : [expected, actual - actual * retentionBps / 10_000n].reduce((a, b) => a > b ? a : b);
}
function traceNode(raw: unknown, bounded: { count: number }, depth: number): TraceNode {
  if (depth > 32 || ++bounded.count > 1024 || raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("bnb_trace_shape");
  const r = raw as Record<string, unknown>, allowed = new Set(["type", "from", "to", "value", "input", "output", "error", "revertReason", "calls", "gas", "gasUsed"]);
  if (Object.keys(r).some((key) => !allowed.has(key)) || (r.type !== "CALL" && r.type !== "STATICCALL")) fail("bnb_trace_shape");
  const calls = r.calls === undefined ? [] : r.calls;
  if (!Array.isArray(calls) || calls.length > 256) fail("bnb_trace_shape");
  let from: Address, to: Address, input: Hex, output: Hex, value: bigint;
  try { from = getAddress(String(r.from)); to = getAddress(String(r.to)); input = bridgeHex(r.input ?? "0x", 24_576); output = bridgeHex(r.output ?? "0x", 24_576); value = BigInt(String(r.value ?? "0x0")); }
  catch { return fail("bnb_trace_shape"); }
  if (value < 0n || (r.error !== undefined && typeof r.error !== "string")) fail("bnb_trace_shape");
  return { type: r.type, from, to, value, input, output, error: r.error === undefined ? null : r.error as string,
    calls: calls.map((child) => traceNode(child, bounded, depth + 1)) };
}
function walk(node: TraceNode): readonly TraceNode[] { return [node, ...node.calls.flatMap(walk)]; }
function traceProjection(node: TraceNode): unknown { return { ...node, value: node.value.toString(), calls: node.calls.map(traceProjection) }; }
function assertCallerTree(node: TraceNode): void {
  for (const child of node.calls) { if (child.from !== node.to) mismatch(); assertCallerTree(child); }
}
function exactFrame(node: TraceNode, to: Address, selector: Hex | null, _reason: string): void {
  if (node.type !== "CALL" || node.to !== to || node.error !== null || node.value !== 0n || (selector !== null && node.input.slice(0, 10) !== selector)) mismatch();
}
function decode(input: Hex, name: string): readonly unknown[] {
  try { const d = decodeFunctionData({ abi: TRACE_ABI, data: input }); if (d.functionName !== name) mismatch(); return d.args as readonly unknown[]; }
  catch (error) { if (error instanceof TraceMismatch) throw error; return mismatch(); }
}
function exactToken(node: TraceNode | undefined, token: Address, name: "approve" | "transfer" | "transferFrom", args: readonly unknown[]): void {
  if (node === undefined || node.type !== "CALL" || node.to !== token || node.error !== null || node.value !== 0n ||
    node.output !== `0x${"0".repeat(63)}1` || node.calls.length !== 0) mismatch();
  const got = decode(node.input, name); if (got.length !== args.length || got.some((v, i) => String(v) !== String(args[i]))) mismatch();
}

function coreInvocation(flyCalldata: Hex): Hex {
  const raw = Buffer.from(flyCalldata.slice(2), "hex"), payloadLength = Number(uint(raw, 36, 32));
  if (payloadLength <= 0 || 68 + payloadLength > raw.length) return mismatch();
  const selector = Buffer.from("158f6894", "hex"), head = raw.subarray(4, 68), payload = raw.subarray(68, 68 + payloadLength);
  return `0x${Buffer.concat([selector, head, payload]).toString("hex")}`;
}

function compact(p: Buffer, at: number): bigint {
  const shift = p[at]!; const pointer = Number(uint(p, at + 1, 2)); const width = (256 - shift) / 8; const absolute = pointer - 68;
  if (!Number.isInteger(width) || width < 1 || width > 32 || absolute < 0 || absolute + width > 412) fail("fly_pointer");
  return uint(p, absolute, width);
}
function address(p: Buffer, at: number, expected: Address, reason: string): void {
  if (`0x${p.subarray(at, at + 20).toString("hex")}`.toLowerCase() !== expected.toLowerCase()) fail(reason);
}
function uint(p: Buffer, at: number, size: number): bigint {
  if (at < 0 || size < 1 || at + size > p.length) fail("fly_range");
  return BigInt(`0x${p.subarray(at, at + size).toString("hex")}`);
}
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", reason); }
