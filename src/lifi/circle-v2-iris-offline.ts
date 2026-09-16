/** Offline CCTP V2 Iris response inspection. No network, signature verification, or settlement claim.
 * Layout: https://developers.circle.com/cctp/references/technical-guide
 * Envelope: https://developers.circle.com/api-reference/cctp/all/get-messages-v2
 */
import { bridgeFailure } from "./validation.js";

const ZERO = `0x${"00".repeat(32)}`;
const BASE_USDC = "0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export interface CircleV2ExpectedBurn {
  /** Independently known successful Base source transaction. */
  readonly sourceTransactionHash: string;
  /** Solana USDC associated token account, as the exact 32-byte account key. */
  readonly mintRecipient: string;
  readonly amountAtomic: string;
  readonly messageSender: string;
  /** Expected CCTP TokenMessengerV2 recipient on Solana, as bytes32. */
  readonly messageRecipient: string;
  readonly maxFeeAtomic: string;
  readonly hookData: string;
  readonly minFinalityThreshold: 1000 | 2000;
  readonly finalityThresholdExecuted: 1000 | 2000;
}

export interface CircleV2IrisHint {
  readonly kind: "offline_circle_cctp_v2_iris_hint";
  readonly sourceTransactionHash: string;
  readonly message: string;
  readonly attestation: string;
  readonly nonce: string;
  /** Shape-checked Iris API metadata; not an onchain-verified V2 message nonce. */
  readonly eventNonce: string;
  readonly sender: string;
  readonly recipient: string;
  readonly mintRecipient: string;
  readonly amountAtomic: string;
  readonly maxFeeAtomic: string;
  readonly feeExecutedAtomic: string;
  readonly expirationBlock: string;
  readonly hookData: string;
  readonly minFinalityThreshold: 1000 | 2000;
  readonly finalityThresholdExecuted: 1000 | 2000;
  readonly providerStatus: "complete";
  readonly attestationAuthenticated: false;
  readonly bridgeCompletion: false;
}

function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_${reason}`); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("shape");
  return value as Record<string, unknown>;
}
function hex(value: unknown, bytes?: number): string {
  if (typeof value !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/u.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)) fail("hex");
  return value.toLowerCase();
}
function decimal(value: unknown, positive = false): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value) || (positive && value === "0")) fail("decimal");
  return value;
}
function word(bytes: string, offset: number, length: number): string {
  const end = 2 + (offset + length) * 2;
  if (bytes.length < end) fail("truncated_message");
  return `0x${bytes.slice(2 + offset * 2, end)}`;
}
function uint(bytes: string, offset: number, length: number): bigint { return BigInt(word(bytes, offset, length)); }
function sameWord(decoded: unknown, raw: string): boolean {
  if (typeof decoded !== "string" || !/^0x[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/u.test(decoded)) return false;
  return decoded.length === 42 ? `0x${"0".repeat(24)}${decoded.slice(2).toLowerCase()}` === raw : decoded.toLowerCase() === raw;
}
function sameDecimal(decoded: unknown, raw: bigint): boolean {
  return typeof decoded === "string" && /^(?:0|[1-9][0-9]*)$/u.test(decoded) && BigInt(decoded) === raw;
}
function sameNonce(decoded: unknown, raw: bigint, rawWord: string): boolean {
  return sameDecimal(decoded, raw) || (typeof decoded === "string" && /^0x[a-fA-F0-9]{64}$/u.test(decoded) && decoded.toLowerCase() === rawWord);
}

/** Accepts the raw JSON body of GET /v2/messages/6?transactionHash=<expected hash>. */
export function inspectCircleV2IrisOffline(response: unknown, expected: CircleV2ExpectedBurn): CircleV2IrisHint {
  const sourceTransactionHash = hex(expected.sourceTransactionHash, 32);
  if (sourceTransactionHash === ZERO) fail("source_hash");
  const mintRecipient = hex(expected.mintRecipient, 32);
  const messageSender = hex(expected.messageSender, 32);
  const messageRecipient = hex(expected.messageRecipient, 32);
  const expectedHook = expected.hookData === "0x" ? "0x" : hex(expected.hookData);
  const amount = BigInt(decimal(expected.amountAtomic, true));
  const maxFee = BigInt(decimal(expected.maxFeeAtomic));
  if (mintRecipient === ZERO || messageSender === ZERO || messageRecipient === ZERO ||
    maxFee > amount || ![1000, 2000].includes(expected.minFinalityThreshold) ||
    ![1000, 2000].includes(expected.finalityThresholdExecuted) ||
    expected.finalityThresholdExecuted < expected.minFinalityThreshold) fail("expected_binding");

  const envelope = record(response);
  if (hex(envelope.sourceTxHash, 32) !== sourceTransactionHash) fail("source_hash");
  if (!Array.isArray(envelope.messages) || envelope.messages.length !== 1) fail("message_count");
  const entry = record(envelope.messages[0]);
  if (entry.cctpVersion !== 2 || entry.status !== "complete") fail("status_or_version");
  const message = hex(entry.message);
  // 148-byte V2 header and 228-byte fixed BurnMessageV2 body; remaining bytes are hook data.
  if (message.length < 2 + (148 + 228) * 2) fail("message_length");
  const body = `0x${message.slice(2 + 148 * 2)}`;
  const hookData = `0x${body.slice(2 + 228 * 2)}`;
  const nonceWord = word(message, 12, 32);
  const nonce = uint(message, 12, 32);
  const sender = word(message, 44, 32), recipient = word(message, 76, 32);
  const minFinality = Number(uint(message, 140, 4));
  const executedFinality = Number(uint(message, 144, 4));
  const feeExecuted = uint(body, 164, 32);
  const expirationBlock = uint(body, 196, 32);
  if (uint(message, 0, 4) !== 1n || uint(message, 4, 4) !== 6n || uint(message, 8, 4) !== 5n ||
    nonce === 0n || sender !== messageSender || recipient !== messageRecipient ||
    word(message, 108, 32) !== ZERO || minFinality !== expected.minFinalityThreshold ||
    executedFinality !== expected.finalityThresholdExecuted ||
    uint(body, 0, 4) !== 1n || word(body, 4, 32) !== BASE_USDC ||
    word(body, 36, 32) !== mintRecipient || uint(body, 68, 32) !== amount ||
    word(body, 100, 32) !== messageSender || uint(body, 132, 32) !== maxFee ||
    feeExecuted > maxFee || expirationBlock === 0n || hookData !== expectedHook) fail("message_binding");

  const eventNonce = decimal(entry.eventNonce);
  const attestation = hex(entry.attestation);
  if ((attestation.length - 2) % 130 !== 0 || attestation.length < 132) fail("attestation_shape");
  const decoded = record(entry.decodedMessage), decodedBody = record(decoded.decodedMessageBody);
  if (!sameDecimal(decoded.sourceDomain, 6n) || !sameDecimal(decoded.destinationDomain, 5n) ||
    !sameNonce(decoded.nonce, nonce, nonceWord) || !sameWord(decoded.sender, sender) ||
    !sameWord(decoded.recipient, recipient) || !sameWord(decoded.destinationCaller, ZERO) ||
    hex(decoded.messageBody) !== body || !sameWord(decodedBody.burnToken, BASE_USDC) ||
    !sameWord(decodedBody.mintRecipient, mintRecipient) || !sameDecimal(decodedBody.amount, amount) ||
    !sameWord(decodedBody.messageSender, messageSender)) fail("decoded_message_binding");
  // Optional newer decoded fields must agree if Iris includes them.
  if (decoded.minFinalityThreshold !== undefined && !sameDecimal(decoded.minFinalityThreshold, BigInt(minFinality)) ||
    decoded.finalityThresholdExecuted !== undefined && !sameDecimal(decoded.finalityThresholdExecuted, BigInt(executedFinality)) ||
    decodedBody.maxFee !== undefined && !sameDecimal(decodedBody.maxFee, maxFee) ||
    decodedBody.feeExecuted !== undefined && !sameDecimal(decodedBody.feeExecuted, feeExecuted) ||
    decodedBody.expirationBlock !== undefined && !sameDecimal(decodedBody.expirationBlock, expirationBlock) ||
    decodedBody.hookData !== undefined &&
      (decodedBody.hookData === "0x" ? "0x" : hex(decodedBody.hookData)) !== hookData) fail("decoded_message_binding");
  return { kind: "offline_circle_cctp_v2_iris_hint", sourceTransactionHash, message, attestation,
    nonce: nonceWord, eventNonce, sender, recipient, mintRecipient, amountAtomic: amount.toString(),
    maxFeeAtomic: maxFee.toString(), feeExecutedAtomic: feeExecuted.toString(),
    expirationBlock: expirationBlock.toString(), hookData,
    minFinalityThreshold: expected.minFinalityThreshold,
    finalityThresholdExecuted: expected.finalityThresholdExecuted, providerStatus: "complete",
    attestationAuthenticated: false, bridgeCompletion: false };
}
