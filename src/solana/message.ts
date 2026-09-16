import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner,
  createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, type Instruction,
  getPublicKeyFromAddress, verifySignature,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { sha256 } from "../canonical.js";
import { SOLANA_USDC } from "../chain-policy.js";
import type { RailPreparedTransfer, RailSendBinding, RailSignedEffect } from "../direct-rail-ports.js";

/** Only the two lifetime fields are needed to compile bytes, so the guard can compile before it simulates. */
export type RailSendLifetime = Pick<RailSendBinding, "blockReference" | "lastValidBlockHeight">;
import { ApnError } from "../errors.js";
import { associatedUsdc } from "./accounts.js";
import { solanaAddress, solanaSignature } from "./rpc.js";

/** `send` supersedes the preparation-time lifetime once the send guard has re-acquired one. */
export async function solanaMessage(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "blockReference" | "lastValidBlockHeight" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">, send: RailSendLifetime | null = null) {
  const sender = createNoopSigner(address(solanaAddress(input.sender)));
  const instructions = await solanaTransferInstructions(input);
  const lifetime = send === null
    ? { blockReference: input.blockReference, lastValidBlockHeight: input.lastValidBlockHeight }
    : { blockReference: send.blockReference, lastValidBlockHeight: send.lastValidBlockHeight };
  if (lifetime.lastValidBlockHeight === null) invalid();
  const message = appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.blockReference), lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight) },
      setTransactionMessageFeePayerSigner(sender, createTransactionMessage({ version: 0 }))));
  const transaction = compileTransaction(message);
  return { transaction, unsignedPayload: getBase64EncodedWireTransaction(transaction), messageBase64: Buffer.from(transaction.messageBytes).toString("base64") };
}
export async function solanaTransferInstructions(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">, rentPayer = input.sender): Promise<readonly Instruction[]> {
  const sender = createNoopSigner(address(solanaAddress(input.sender)));
  const recipient = address(solanaAddress(input.recipient)); const instructions: Instruction[] = [];
  if (input.asset.alias === "sol") {
    instructions.push(getTransferSolInstruction({ source: sender, destination: recipient, amount: BigInt(input.amountAtomic) }));
  } else if (input.asset.alias === "usdc") {
    const source = await associatedUsdc(input.sender); const destination = await associatedUsdc(input.recipient);
    if (source !== input.sourceTokenAccount || destination !== input.destinationTokenAccount) invalid();
    if (input.createsRecipientAccount) instructions.push(getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(address(solanaAddress(rentPayer))), ata: address(destination), owner: recipient, mint: address(SOLANA_USDC),
    }));
    instructions.push(getTransferCheckedInstruction({ source: address(source), mint: address(SOLANA_USDC),
      destination: address(destination), authority: sender, amount: BigInt(input.amountAtomic), decimals: 6 }));
  } else invalid();
  return instructions;
}
/**
 * Without a send binding the bytes must equal the frozen payload exactly. With one, every field but
 * the re-acquired lifetime must still equal it, which is proven by rebuilding from the same frozen
 * record and only substituting the lifetime the send guard recorded.
 */
export async function validateSolanaMessage(prepared: RailPreparedTransfer, send: RailSendBinding | null = null) {
  const expected = await solanaMessage(prepared, send);
  if (send === null && expected.unsignedPayload !== prepared.unsignedPayload) invalid();
  if (send !== null && (await solanaMessage(prepared)).unsignedPayload !== prepared.unsignedPayload) invalid();
  return expected;
}
export async function validateSolanaEffect(prepared: RailPreparedTransfer, effect: RailSignedEffect, send: RailSendBinding | null = null): Promise<void> {
  const expected = await validateSolanaMessage(prepared, send);
  if (sha256(effect.rawPayload) !== effect.rawPayloadHash || effect.rawPayload.length > 2048) invalid();
  const bytes = Buffer.from(effect.rawPayload, "base64");
  if (bytes.toString("base64") !== effect.rawPayload) invalid();
  const transaction = getTransactionDecoder().decode(bytes);
  if (Buffer.from(transaction.messageBytes).toString("base64") !== expected.messageBase64 || getSignatureFromTransaction(transaction) !== solanaSignature(effect.transactionId) ||
    Object.keys(transaction.signatures).length !== 1 || transaction.signatures[address(prepared.sender)] === null ||
    getBase64EncodedWireTransaction(transaction) !== effect.rawPayload) invalid();
  const signature = transaction.signatures[address(prepared.sender)];
  if (signature === undefined || signature === null || !await verifySignature(await getPublicKeyFromAddress(address(prepared.sender)), signature, transaction.messageBytes)) invalid();
}
function invalid(): never { throw new ApnError("APN_STATE_CORRUPT", "The Solana transaction bytes do not match the frozen direct transfer."); }
