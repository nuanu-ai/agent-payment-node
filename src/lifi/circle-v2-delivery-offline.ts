/** Pure offline correlation of caller supplied Base, Iris, and finalized Solana observations. */
import { keccak256, type Hex } from "viem";
import { decodeCircleV2BaseSourceReceiptOffline, type CircleV2BurnIntent } from "./circle-v2-source-receipt.js";
import { inspectCircleV2IrisOffline, type CircleV2ExpectedBurn } from "./circle-v2-iris-offline.js";
import { inspectCircleV2SolanaMintEventOffline, type CircleV2SolanaDestinationInput } from "./circle-v2-solana-destination-offline.js";
import { bridgeFailure } from "./validation.js";

export interface CircleV2DeliveryOfflineInput {
  readonly intent: CircleV2BurnIntent;
  /** Caller authenticated safe Base transaction and receipt. */
  readonly sourceTransaction: unknown;
  readonly sourceReceipt: unknown;
  /** Caller supplied, unauthenticated Iris JSON response. */
  readonly irisResponse: unknown;
  /** Caller authenticated finalized Solana RPC observations. */
  readonly destination: Omit<CircleV2SolanaDestinationInput, "attestedMessageHex" | "nonceHex" | "expectedAttestationHex">;
}

const fail = (reason: string): never => bridgeFailure("APN_RPC_PROTOCOL", `circle_v2_delivery_${reason}`);
const byteLength = (hex: string): number => (hex.length - 2) / 2;

/** Circle V2 attestation may fill only these formerly zero source-message byte ranges. */
function compareAttestedMessage(source: string, attested: string): void {
  if (byteLength(source) !== byteLength(attested)) fail("message_length");
  const mutable = [[12, 44], [144, 148], [312, 344], [344, 376]] as const;
  for (let offset = 0; offset < byteLength(source); offset++) {
    if (mutable.some(([start, end]) => offset >= start && offset < end)) continue;
    const at = 2 + offset * 2;
    if (source.slice(at, at + 2).toLowerCase() !== attested.slice(at, at + 2).toLowerCase()) fail("message_byte_mismatch");
  }
}

export async function inspectCircleV2BaseSolanaDeliveryOffline(input: CircleV2DeliveryOfflineInput) {
  const source = decodeCircleV2BaseSourceReceiptOffline(input.intent, input.sourceTransaction, input.sourceReceipt);
  if (source.minFinalityThreshold !== 1000 && source.minFinalityThreshold !== 2000) fail("finality_threshold");
  const minFinalityThreshold = source.minFinalityThreshold as 1000 | 2000;
  const irisExpected: CircleV2ExpectedBurn = {
    sourceTransactionHash: source.sourceTransactionHash,
    mintRecipient: source.mintRecipient,
    amountAtomic: source.burnAmountAtomic,
    messageSender: `0x${source.message.slice(2 + 44 * 2, 2 + 76 * 2)}`,
    burnMessageSender: `0x${"0".repeat(24)}${source.depositor.slice(2).toLowerCase()}`,
    messageRecipient: source.destinationTokenMessenger,
    maxFeeAtomic: source.maxFeeAtomic,
    hookData: source.hookData,
    minFinalityThreshold,
    // Solana receive_finalized_message accepts finalized CCTP messages only.
    finalityThresholdExecuted: 2000,
  };
  const iris = inspectCircleV2IrisOffline(input.irisResponse, irisExpected);
  if (iris.sourceTransactionHash !== source.sourceTransactionHash.toLowerCase() ||
      iris.amountAtomic !== source.burnAmountAtomic || iris.mintRecipient !== source.mintRecipient.toLowerCase() ||
      iris.sender !== irisExpected.messageSender.toLowerCase() || iris.recipient !== source.destinationTokenMessenger.toLowerCase() ||
      iris.maxFeeAtomic !== source.maxFeeAtomic || iris.hookData !== source.hookData.toLowerCase() ||
      iris.minFinalityThreshold !== source.minFinalityThreshold) fail("field_binding");
  compareAttestedMessage(source.message, iris.message);
  const destination = await inspectCircleV2SolanaMintEventOffline({ ...input.destination,
    attestedMessageHex: iris.message, nonceHex: iris.nonce, expectedAttestationHex: iris.attestation });
  return {
    kind: "offline_circle_cctp_v2_base_solana_delivery_candidate" as const,
    sourceTransactionHash: source.sourceTransactionHash,
    sourceMessageHash: source.messageHash,
    attestedMessageHash: keccak256(iris.message as Hex),
    destinationSignature: input.destination.signature,
    destinationTokenAccount: destination.tokenAccount,
    amountAtomic: source.burnAmountAtomic,
    feeExecutedAtomic: iris.feeExecutedAtomic,
    receivedAtomic: destination.receivedAtomic,
    nonce: iris.nonce,
    source,
    iris,
    destination,
    provenance: "synthetic_untrusted_caller_supplied_offline_observations" as const,
    attestationAuthenticated: false as const,
    chainAuthenticityVerified: false as const,
    executionAdmitted: false as const,
    bridgeCompletion: false as const,
  };
}
