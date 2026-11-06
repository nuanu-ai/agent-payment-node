import { concatHex, decodeAbiParameters, encodeAbiParameters, getAddress, hashTypedData, keccak256, parseAbiParameters, recoverTypedDataAddress } from "viem";
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
  selector: "0x46ec278a" as Hex,
  signer: getAddress("0x28de4113921BD79388B0ef80A259f871977442E9"),
});

const DESTINATION_MESSAGE = parseAbiParameters("bytes32 transactionId, (address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swaps, address finalReceiver");
/** The router reads the packed header through payload byte 206 (`LibRouter.getData`: the fee count at calldata 274). */
const FLY_HEADER_BYTES = 207;
/** Fly's packed program for one WETH -> BNB quote; a three-hop route measured 704 bytes on 2026-11-05. */
const FLY_MAX_PAYLOAD_BYTES = 3072;
/** `LibRouter.recoverSigner` refuses an s above half the secp256k1 order and any v other than 27 or 28. */
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

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

/** Strict parser for the one reviewed LI.FI ReceiverAcrossV4 -> Executor -> Fly destination call. */
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

/**
 * Reads `swapWithBackendSignature(bytes)` the way Fly's router does (`LibRouter.getData`) and checks only that header:
 * the Executor as recipient, WETH in, native out, the exact input amount, the compact deadline, output floor, expected
 * output and retention words, the consumer, no transfer from the router, the signature and no swap fees. The bytes
 * after the header are Fly Core's route for this one quote (pools, hops, wrapping), which Fly picks by liquidity and
 * changes from quote to quote. APN does not interpret them: the router pays the Executor only through the signed retention
 * rule and reverts unless the Executor's native balance grew by at least the signed `amountOutMin`, whatever the route did.
 * Retention only splits output above the signed expected output: the router then pays the larger of that expected output
 * and the output less `maxRetentionBps` of it, so 10000 (what Fly quotes carry since 2026-11-06) leaves Fly everything above
 * expected and never touches the floor. Above 10000 the router's checked subtraction reverts every swap that beats expected.
 */
export function decodeFlyProgram(calldata: Hex, _expectedRecipient: Address, expectedAmount: bigint): Omit<BnbCompositeCall, "kind" | "transactionId" | "finalReceiver" | "inputAmountAtomic" | "messageHash" | "flyCalldata"> {
  const raw = Buffer.from(bridgeHex(calldata, 68 + FLY_MAX_PAYLOAD_BYTES).slice(2), "hex");
  if (raw.length < 4 + 64 || `0x${raw.subarray(0, 4).toString("hex")}` !== BNB_COMPOSITE.selector) fail("fly_selector");
  const offset = uint(raw, 4, 32), length = uint(raw, 36, 32);
  if (offset !== 32n || length < BigInt(FLY_HEADER_BYTES) || length > BigInt(FLY_MAX_PAYLOAD_BYTES)) fail("fly_abi_bounds");
  const payloadStart = 68, payloadEnd = payloadStart + Number(length), paddedEnd = payloadStart + Math.ceil(Number(length) / 32) * 32;
  if (paddedEnd !== raw.length || raw.subarray(payloadEnd).some(Boolean)) fail("fly_abi_padding");
  const p = raw.subarray(payloadStart, payloadEnd);
  // Fly's signed consumer is LI.FI's Executor; the final self recipient is independently bound by the enclosing message.
  address(p, 4, BNB_COMPOSITE.executor, "fly_recipient"); address(p, 24, BNB_COMPOSITE.weth, "fly_input");
  address(p, 44, "0x0000000000000000000000000000000000000000", "fly_output");
  if (uint(p, 64, 32) !== expectedAmount) fail("fly_amount");
  const deadline = compact(p, 96), minimum = compact(p, 99), expected = compact(p, 102), retention = compact(p, 137);
  if (deadline <= 0n || minimum <= 0n || expected < minimum || retention > 10_000n) fail("fly_economics");
  if (p[140] !== 0) fail("fly_transfer_mode");
  if (p[206] !== 0) fail("fly_fee_count");
  const consumerId = `0x${p.subarray(105, 137).toString("hex")}` as Hex;
  const signature = concatHex([`0x${p.subarray(141, 173).toString("hex")}`, `0x${p.subarray(173, 205).toString("hex")}`,
    `0x${p.subarray(205, 206).toString("hex")}`]);
  return { deadlineAtomic: deadline.toString(), minimumOutputAtomic: minimum.toString(), expectedOutputAtomic: expected.toString(),
    maximumRetentionBps: Number(retention), consumerId, signature, payloadHash: keccak256(`0x${p.toString("hex")}`) };
}

/**
 * Rebuild Fly's exact no-fee EIP-712 header authorization; the router checks the same digest against its signer list
 * and refuses the signature forms it would reject. Prepare runs this; a stored record is only re-decoded.
 */
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
  const digest = hashTypedData(typed), signature = Buffer.from(call.signature.slice(2), "hex");
  if (signature.length !== 65 || BigInt(`0x${signature.subarray(32, 64).toString("hex")}`) > SECP256K1_HALF_ORDER ||
    (signature[64] !== 27 && signature[64] !== 28)) fail("fly_signature_form");
  let signer: Address;
  try { signer = getAddress(await recoverTypedDataAddress({ ...typed, signature: call.signature })); } catch { return fail("fly_signature"); }
  if (signer !== authorizedSigner) fail("fly_signer");
  return { digest, signer };
}

/**
 * One compact header word as the router reads it: `calldataload(pointer) >> shift`, the leading (256 - shift) / 8
 * bytes at an absolute calldata pointer. Only whole bytes inside the payload are accepted.
 */
function compact(p: Buffer, at: number): bigint {
  const shift = p[at]!; const pointer = Number(uint(p, at + 1, 2)); const width = (256 - shift) / 8; const absolute = pointer - 68;
  if (!Number.isInteger(width) || width < 1 || width > 32 || absolute < 0 || absolute + width > p.length) fail("fly_pointer");
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
