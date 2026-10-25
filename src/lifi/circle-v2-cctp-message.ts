/**
 * The attested CCTP V2 message of a Circle Base USDC to Solana burn, read from its bytes: Circle's issuer API serves them
 * with the attestation, and MessageTransmitterV2 `receive_message` on Solana carries the same bytes in its instruction data.
 * Header: version, source and destination domain (u32), nonce, sender, recipient, destination caller (bytes32),
 * min and executed finality (u32). BurnMessageV2 body: version (u32), burn token, mint recipient (bytes32), amount
 * (uint256), message sender (bytes32), max fee, fee executed, expiration block (uint256), hook data.
 */
import { createHash } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";
import { circleBurnCall } from "./circle-v2-source-usage.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const CCTP_BASE_DOMAIN = 6, CCTP_SOLANA_DOMAIN = 5;
const HEADER = 148, BODY = 228;
const RECEIVE_MESSAGE = createHash("sha256").update("global:receive_message").digest().subarray(0, 8);

export interface CctpBurnMessage {
  readonly bytes: Buffer; readonly sha256: string; readonly nonce: string;
  readonly sourceDomain: number; readonly destinationDomain: number; readonly burnToken: string; readonly mintRecipient: string;
  readonly amount: bigint; readonly messageSender: string; readonly maxFee: bigint; readonly feeExecuted: bigint;
}
/** What the journal's own burn fixes: the principal, the Solana token account (as bytes32) and the Base messenger. */
export interface CircleBurnTerms {
  readonly amount: bigint; readonly mintRecipient: string; readonly messageSender: string;
  readonly recipientOwner: string; readonly recipientAta: string;
}

const word = (bytes: Buffer, at: number) => `0x${bytes.subarray(at, at + 32).toString("hex")}`;
const uint = (bytes: Buffer, at: number) => BigInt(word(bytes, at));
/** A bytes32 that holds an EVM address: twelve zero bytes, then the address. */
function evmWord(bytes: Buffer, at: number): string | null {
  const value = word(bytes, at);
  return value.slice(2, 26) === "0".repeat(24) ? `0x${value.slice(26)}` : null;
}
function ataWord(ata: string): string | null {
  try { const bytes = getBase58Encoder().encode(ata); return bytes.length === 32 ? `0x${Buffer.from(bytes).toString("hex")}` : null; }
  catch { return null; }
}

/** The burn's terms from the journal's calldata and admission; null when they disagree (the calldata is the signed truth). */
export function circleBurnTerms(journal: NonEvmSourceJournal): CircleBurnTerms | null {
  const call = circleBurnCall(journal), ata = ataWord(journal.admissionProof.recipientAta);
  if (call === null || ata === null || call.destinationDomain !== CCTP_SOLANA_DOMAIN || call.burnToken !== BASE_USDC ||
    call.mintRecipient !== ata || call.amount <= 0n) return null;
  return { amount: call.amount, mintRecipient: ata, messageSender: journal.sourceCall.to.toLowerCase(),
    recipientOwner: journal.admissionProof.recipientOwner, recipientAta: journal.admissionProof.recipientAta };
}

/** A version 1 burn message of exactly one body and hook data; null for any other layout. */
export function decodeCctpBurnMessage(bytes: Buffer): CctpBurnMessage | null {
  if (bytes.length < HEADER + BODY || bytes.length > 4096 || bytes.readUInt32BE(0) !== 1) return null;
  const body = bytes.subarray(HEADER);
  if (body.readUInt32BE(0) !== 1) return null;
  const burnToken = evmWord(body, 4), messageSender = evmWord(body, 100);
  if (burnToken === null || messageSender === null) return null;
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), nonce: word(bytes, 12),
    sourceDomain: bytes.readUInt32BE(4), destinationDomain: bytes.readUInt32BE(8), burnToken, mintRecipient: word(body, 36),
    amount: uint(body, 68), messageSender, maxFee: uint(body, 132), feeExecuted: uint(body, 164) };
}

/** Whether an attested message is this burn's: Base to Solana, Base USDC, the journal's messenger, account and principal. */
export function messageBindsBurn(message: CctpBurnMessage, terms: CircleBurnTerms): boolean {
  return message.sourceDomain === CCTP_BASE_DOMAIN && message.destinationDomain === CCTP_SOLANA_DOMAIN &&
    message.burnToken === BASE_USDC && message.messageSender === terms.messageSender && message.mintRecipient === terms.mintRecipient &&
    message.amount === terms.amount && message.feeExecuted <= message.maxFee && message.feeExecuted < message.amount;
}

/** The message bytes of a MessageTransmitterV2 `receive_message` instruction (Anchor: discriminator, two borsh vectors). */
export function receiveMessageBytes(data: unknown): Buffer | null {
  if (typeof data !== "string" || data.length === 0 || data.length > 2048) return null;
  let bytes: Buffer;
  try { bytes = Buffer.from(getBase58Encoder().encode(data)); } catch { return null; }
  if (bytes.length < 16 || !bytes.subarray(0, 8).equals(RECEIVE_MESSAGE)) return null;
  const messageLength = bytes.readUInt32LE(8);
  if (12 + messageLength + 4 > bytes.length) return null;
  const attestationLength = bytes.readUInt32LE(12 + messageLength);
  if (16 + messageLength + attestationLength !== bytes.length) return null;
  return bytes.subarray(12, 12 + messageLength);
}
